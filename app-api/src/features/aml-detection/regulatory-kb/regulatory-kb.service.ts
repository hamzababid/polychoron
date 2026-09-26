import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Client, WorkflowNotFoundError } from '@temporalio/client';
import {
  RegulatoryChunk,
  RegulatoryChunkingProfile,
  RegulatoryDocument,
  RegulatoryDocumentChange,
} from '../../../platform/entities/index.js';
import { TEMPORAL_CLIENT } from '../../../common/temporal/temporal.module.js';
import { IngestRegulatoryDocumentDto } from '../dto/ingest-regulatory-document.dto.js';
import { KB_FEATURE_CODE } from './regulatory-kb-commands.service.js';

const TASK_QUEUE = 'aml_detection-task-queue';
const STATUSES = ['draft', 'current', 'superseded', 'withdrawn'] as const;
type DocumentStatus = (typeof STATUSES)[number];

export interface DocumentListQuery {
  status?: string;
  sourceType?: string;
  issuingAuthority?: string;
  tag?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface RegulatoryDocumentRow {
  documentId: string;
  documentFamilyId: string;
  versionNumber: number;
  title: string;
  sourceType: string;
  issuingAuthority: string;
  versionLabel: string;
  effectiveDate: string | null;
  status: DocumentStatus;
  supersededBy: string | null;
  sourceUrl: string | null;
  tags: string[];
  ingestedAt: string;
  ingestedBy: string;
  chunkCount: number;
  embeddedCount: number;
  lastChangedAt: string;
}

export interface RegulatoryDocumentDetail extends RegulatoryDocumentRow {
  jurisdiction: string;
  language: string;
  relatedTypologyCodes: string[];
  retrievalEnabled: boolean;
  retrievalPriority: number;
  notes: string | null;
  sourceMethod: string;
  chunkingConfig: Record<string, unknown> | null;
  publishedBy: string | null;
  publishedAt: string | null;
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  hasExtractedText: boolean;
  unacknowledgedInjectionCount: number;
  sourceFile: {
    fileId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    fetchedFromUrl: string | null;
    uploadedAt: string;
  } | null;
  family: { currentDocumentId: string | null; draftDocumentId: string | null; versionCount: number };
}

export interface RegulatoryChunkRow {
  chunkId: string;
  ordinal: number;
  sectionReference: string;
  text: string;
  charCount: number;
  embedded: boolean;
  injectionFlags: string[];
  injectionAcknowledged: boolean;
  citedByCaseCount: number;
  warnings: string[];
}

export interface IngestionJobStatus {
  jobId: string;
  kind: 'embed' | 'reembed' | 'ingest';
  status: 'running' | 'completed' | 'failed';
  progress?: { done: number; total: number };
  documentId?: string;
  chunkCount?: number;
  error?: string;
}

const DOC_COLUMNS = `
  d.document_id, d.document_family_id, d.version_number, d.title, d.source_type, d.issuing_authority,
  d.version_label, d.effective_date, d.status, d.superseded_by, d.source_url, d.tags, d.ingested_at,
  d.ingested_by,
  (SELECT count(*)::int FROM regulatory_chunks c WHERE c.document_id = d.document_id) AS chunk_count,
  (SELECT count(*)::int FROM regulatory_chunks c WHERE c.document_id = d.document_id AND c.embedding IS NOT NULL) AS embedded_count,
  greatest(d.ingested_at, d.published_at, d.withdrawn_at,
           (SELECT max(ch.changed_at) FROM regulatory_document_changes ch WHERE ch.document_id = d.document_id)) AS last_changed_at`;

/** Read side of the Regulatory Knowledge Base screens
 * (specs/suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md).
 * Reads go straight to Postgres — both services read freely across the
 * ownership line (spec 09). Every write goes through
 * RegulatoryKbCommandsService instead. */
@Injectable()
export class RegulatoryKbService {
  constructor(
    @InjectRepository(RegulatoryDocument) private readonly documents: Repository<RegulatoryDocument>,
    @InjectRepository(RegulatoryChunk) private readonly chunks: Repository<RegulatoryChunk>,
    @InjectRepository(RegulatoryDocumentChange) private readonly changes: Repository<RegulatoryDocumentChange>,
    @InjectRepository(RegulatoryChunkingProfile) private readonly profiles: Repository<RegulatoryChunkingProfile>,
    @Inject(TEMPORAL_CLIENT) private readonly temporalClient: Client,
  ) {}

  async listDocuments(query: DocumentListQuery = {}) {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where: string[] = ['d.feature_code = $1'];
    const params: unknown[] = [KB_FEATURE_CODE];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    const statuses = (query.status ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is DocumentStatus => (STATUSES as readonly string[]).includes(s));
    if (query.sourceType) add('d.source_type = ?', query.sourceType);
    if (query.issuingAuthority) add('d.issuing_authority = ?', query.issuingAuthority);
    if (query.tag) add('? = ANY(d.tags)', query.tag);
    if (query.q?.trim()) {
      add(
        `(d.title ILIKE ? OR d.issuing_authority ILIKE $${params.length + 1} OR EXISTS (SELECT 1 FROM unnest(d.tags) t WHERE t ILIKE $${params.length + 1})
          OR EXISTS (SELECT 1 FROM regulatory_chunks c WHERE c.document_id = d.document_id AND c.section_reference ILIKE $${params.length + 1}))`,
        `%${query.q.trim()}%`,
      );
    }

    // Status counts ignore the status filter itself, so the header strip
    // always shows the whole picture for the other filters.
    const countRows = (await this.documents.query(
      `SELECT d.status, count(*)::int AS n FROM regulatory_documents d WHERE ${where.join(' AND ')} GROUP BY d.status`,
      params,
    )) as { status: DocumentStatus; n: number }[];
    const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<DocumentStatus, number>;
    for (const r of countRows) statusCounts[r.status] = r.n;

    if (statuses.length) add('d.status = ANY(?)', statuses);
    const filtered = `FROM regulatory_documents d WHERE ${where.join(' AND ')}`;
    const [{ total }] = (await this.documents.query(`SELECT count(*)::int AS total ${filtered}`, params)) as { total: number }[];
    const rows = (await this.documents.query(
      `SELECT ${DOC_COLUMNS} ${filtered}
       ORDER BY CASE d.status WHEN 'draft' THEN 0 WHEN 'current' THEN 1 WHEN 'withdrawn' THEN 2 ELSE 3 END,
                d.title, d.version_number DESC
       LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params,
    )) as Record<string, unknown>[];

    return { items: rows.map(toRow), total, page, pageSize, statusCounts };
  }

  async getDocument(documentId: string): Promise<RegulatoryDocumentDetail> {
    const row = await this.loadRaw(documentId);
    const [family] = (await this.documents.query(
      `SELECT
         (SELECT document_id FROM regulatory_documents WHERE document_family_id = $1 AND status = 'current') AS current_id,
         (SELECT document_id FROM regulatory_documents WHERE document_family_id = $1 AND status = 'draft') AS draft_id,
         (SELECT count(*)::int FROM regulatory_documents WHERE document_family_id = $1) AS version_count`,
      [row.document_family_id],
    )) as { current_id: string | null; draft_id: string | null; version_count: number }[];
    const [file] = row.source_file_id
      ? ((await this.documents.query(
          `SELECT file_id, filename, content_type, size_bytes, sha256, fetched_from_url, uploaded_at
           FROM regulatory_source_files WHERE file_id = $1`,
          [row.source_file_id],
        )) as Record<string, unknown>[])
      : [];

    return {
      ...toRow(row),
      jurisdiction: row.jurisdiction as string,
      language: row.language as string,
      relatedTypologyCodes: (row.related_typology_codes as string[]) ?? [],
      retrievalEnabled: row.retrieval_enabled as boolean,
      retrievalPriority: Number(row.retrieval_priority),
      notes: (row.notes as string | null) ?? null,
      sourceMethod: row.source_method as string,
      chunkingConfig: (row.chunking_config as Record<string, unknown> | null) ?? null,
      publishedBy: (row.published_by as string | null) ?? null,
      publishedAt: iso(row.published_at),
      withdrawnBy: (row.withdrawn_by as string | null) ?? null,
      withdrawnAt: iso(row.withdrawn_at),
      withdrawalReason: (row.withdrawal_reason as string | null) ?? null,
      hasExtractedText: Boolean(row.has_extracted_text),
      unacknowledgedInjectionCount: Number(row.unacknowledged_injection_count),
      sourceFile: file
        ? {
            fileId: file.file_id as string,
            filename: file.filename as string,
            contentType: file.content_type as string,
            sizeBytes: Number(file.size_bytes),
            sha256: file.sha256 as string,
            fetchedFromUrl: (file.fetched_from_url as string | null) ?? null,
            uploadedAt: iso(file.uploaded_at) as string,
          }
        : null,
      family: { currentDocumentId: family.current_id, draftDocumentId: family.draft_id, versionCount: family.version_count },
    };
  }

  async listChunks(documentId: string, q?: string): Promise<RegulatoryChunkRow[]> {
    const doc = await this.loadRaw(documentId);
    const params: unknown[] = [documentId];
    let filter = '';
    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      filter = 'AND (c.section_reference ILIKE $2 OR c.text ILIKE $2)';
    }
    const rows = (await this.chunks.query(
      `SELECT c.chunk_id, c.ordinal, c.section_reference, c.text, c.char_count, c.embedding IS NOT NULL AS embedded,
              c.injection_flags, c.injection_acknowledged_by IS NOT NULL AS acknowledged,
              (SELECT count(*)::int FROM aml_typology_matches m
               WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(m.regulatory_citations) cit
                             WHERE cit->>'chunk_id' = c.chunk_id::text)) AS cited_by
       FROM regulatory_chunks c WHERE c.document_id = $1 ${filter} ORDER BY c.ordinal`,
      params,
    )) as Record<string, unknown>[];

    const config = (doc.chunking_config as { min_chunk_chars?: number; max_chunk_chars?: number } | null) ?? {};
    const minChars = config.min_chunk_chars ?? 120;
    const maxChars = config.max_chunk_chars ?? 2000;
    const refCounts = new Map<string, number>();
    for (const r of rows) {
      const key = String(r.section_reference).trim().toLowerCase();
      refCounts.set(key, (refCounts.get(key) ?? 0) + 1);
    }
    return rows.map((r) => {
      const warnings: string[] = [];
      const chars = Number(r.char_count);
      if (chars < minChars) warnings.push('too_short');
      if (chars > maxChars) warnings.push('too_long');
      if ((refCounts.get(String(r.section_reference).trim().toLowerCase()) ?? 0) > 1) warnings.push('duplicate_section_reference');
      return {
        chunkId: r.chunk_id as string,
        ordinal: Number(r.ordinal),
        sectionReference: r.section_reference as string,
        text: r.text as string,
        charCount: chars,
        embedded: Boolean(r.embedded),
        injectionFlags: (r.injection_flags as string[]) ?? [],
        injectionAcknowledged: Boolean(r.acknowledged),
        citedByCaseCount: Number(r.cited_by),
        warnings,
      };
    });
  }

  async listVersions(documentId: string): Promise<RegulatoryDocumentRow[]> {
    const doc = await this.loadRaw(documentId);
    const rows = (await this.documents.query(
      `SELECT ${DOC_COLUMNS} FROM regulatory_documents d WHERE d.document_family_id = $1 ORDER BY d.version_number DESC`,
      [doc.document_family_id],
    )) as Record<string, unknown>[];
    return rows.map(toRow);
  }

  async listChanges(documentId: string) {
    await this.loadRaw(documentId);
    const rows = await this.changes.find({ where: { documentId }, order: { changedAt: 'DESC' } });
    return rows.map((c) => ({
      changeId: c.changeId,
      fieldName: c.fieldName,
      oldValue: c.oldValue ?? null,
      newValue: c.newValue ?? null,
      changedBy: c.changedBy,
      changedAt: c.changedAt.toISOString(),
      reason: c.reason,
    }));
  }

  async listCitations(documentId: string, page = 1, pageSize = 20) {
    await this.loadRaw(documentId);
    const base = `
      FROM aml_typology_matches m JOIN aml_cases k ON k.case_id = m.case_id
      WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(m.regulatory_citations) cit
                    JOIN regulatory_chunks c ON c.chunk_id::text = cit->>'chunk_id'
                    WHERE c.document_id = $1)`;
    const [{ total }] = (await this.documents.query(`SELECT count(*)::int AS total ${base}`, [documentId])) as { total: number }[];
    const rows = (await this.documents.query(
      `SELECT k.case_id, k.alert->>'source_alert_id' AS source_alert_id, k.alert->>'customer_id' AS customer_id,
              k.status, m.typology_label, m.matched_at,
              (SELECT array_agg(DISTINCT c.section_reference) FROM jsonb_array_elements(m.regulatory_citations) cit
               JOIN regulatory_chunks c ON c.chunk_id::text = cit->>'chunk_id' WHERE c.document_id = $1) AS sections
       ${base} ORDER BY m.matched_at DESC LIMIT ${Math.min(100, pageSize)} OFFSET ${(Math.max(1, page) - 1) * pageSize}`,
      [documentId],
    )) as Record<string, unknown>[];
    return {
      total,
      page,
      pageSize,
      items: rows.map((r) => ({
        caseId: r.case_id as string,
        sourceAlertId: r.source_alert_id as string,
        customerId: r.customer_id as string,
        caseStatus: r.status as string,
        typologyLabel: r.typology_label as string,
        matchedAt: iso(r.matched_at) as string,
        citedSections: (r.sections as string[]) ?? [],
      })),
    };
  }

  async compare(documentId: string, otherId: string) {
    const [a, b] = await Promise.all([this.getDocument(documentId), this.getDocument(otherId)]);
    if (a.documentFamilyId !== b.documentFamilyId) {
      throw new ConflictException('Only versions of the same document can be compared.');
    }
    const [older, newer] = a.versionNumber <= b.versionNumber ? [a, b] : [b, a];
    const [olderChunks, newerChunks] = await Promise.all([this.listChunks(older.documentId), this.listChunks(newer.documentId)]);

    const fields = [
      'title', 'sourceType', 'issuingAuthority', 'versionLabel', 'effectiveDate', 'sourceUrl', 'jurisdiction', 'language',
      'tags', 'relatedTypologyCodes', 'retrievalEnabled', 'retrievalPriority', 'notes',
    ] as const;
    const metadata = fields
      .map((field) => ({ field, older: older[field] ?? null, newer: newer[field] ?? null }))
      .filter((f) => JSON.stringify(f.older) !== JSON.stringify(f.newer));

    const byRef = (rows: RegulatoryChunkRow[]) => new Map(rows.map((c) => [c.sectionReference.trim().toLowerCase(), c]));
    const olderMap = byRef(olderChunks);
    const newerMap = byRef(newerChunks);
    const chunks: { status: 'added' | 'removed' | 'changed' | 'unchanged'; sectionReference: string; olderText: string | null; newerText: string | null }[] = [];
    for (const c of newerChunks) {
      const prev = olderMap.get(c.sectionReference.trim().toLowerCase());
      chunks.push({
        status: !prev ? 'added' : prev.text === c.text ? 'unchanged' : 'changed',
        sectionReference: c.sectionReference,
        olderText: prev?.text ?? null,
        newerText: c.text,
      });
    }
    for (const c of olderChunks) {
      if (!newerMap.has(c.sectionReference.trim().toLowerCase())) {
        chunks.push({ status: 'removed', sectionReference: c.sectionReference, olderText: c.text, newerText: null });
      }
    }
    return { older: toCompareHeader(older), newer: toCompareHeader(newer), metadata, chunks };
  }

  /** Full extracted text of a draft — for the wizard's live heading-regex
   * match counter. Drafts only; published documents keep no copy. */
  async getExtractedText(documentId: string): Promise<{ text: string | null }> {
    const doc = await this.documents
      .createQueryBuilder('d')
      .addSelect('d.extractedText')
      .where('d.documentId = :documentId AND d.featureCode = :featureCode', { documentId, featureCode: KB_FEATURE_CODE })
      .getOne();
    if (!doc) throw new NotFoundException(`No regulatory document with document_id=${documentId}`);
    return { text: doc.extractedText ?? null };
  }

  async listProfiles() {
    const rows = await this.profiles.find({ where: { featureCode: KB_FEATURE_CODE }, order: { name: 'ASC' } });
    return rows.map((p) => ({ profileId: p.profileId, name: p.name, config: p.config, createdBy: p.createdBy, createdAt: p.createdAt.toISOString() }));
  }

  async listIssuingAuthorities(): Promise<string[]> {
    const rows = (await this.documents.query(
      `SELECT DISTINCT issuing_authority FROM regulatory_documents WHERE feature_code = $1 AND issuing_authority <> '' ORDER BY 1`,
      [KB_FEATURE_CODE],
    )) as { issuing_authority: string }[];
    return rows.map((r) => r.issuing_authority);
  }

  /** Kept for scripts/tests (spec: "Kept for compatibility") — the new
   * screens create drafts instead. */
  async startIngestion(dto: IngestRegulatoryDocumentDto): Promise<{ jobId: string }> {
    if (dto.supersedes_document_id) {
      const existing = await this.documents.findOneBy({ documentId: dto.supersedes_document_id });
      if (!existing) {
        throw new NotFoundException(`No regulatory document with document_id=${dto.supersedes_document_id} to supersede`);
      }
    }

    const jobId = `regulatory-ingestion-${randomUUID()}`;
    await this.temporalClient.workflow.start('RegulatoryDocumentIngestionWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: jobId,
      args: [
        {
          feature_code: KB_FEATURE_CODE,
          title: dto.title,
          source_type: dto.source_type,
          issuing_authority: dto.issuing_authority,
          version_label: dto.version_label,
          source_url: dto.source_url,
          ingested_by: dto.ingested_by,
          chunks: dto.chunks.map((c) => ({ section_reference: c.section_reference, text: c.text })),
          supersedes_document_id: dto.supersedes_document_id,
        },
      ],
    });

    return { jobId };
  }

  async assertExists(documentId: string): Promise<void> {
    await this.loadRaw(documentId);
  }

  async getJobStatus(jobId: string): Promise<IngestionJobStatus> {
    const kind: IngestionJobStatus['kind'] = jobId.startsWith('regulatory-embed-')
      ? 'embed'
      : jobId.startsWith('regulatory-reembed-')
        ? 'reembed'
        : 'ingest';
    const handle = this.temporalClient.workflow.getHandle(jobId);
    let description;
    try {
      description = await handle.describe();
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) throw new NotFoundException(`No job ${jobId}`);
      throw err;
    }
    const statusName = description.status.name;
    const progress = kind === 'ingest' ? undefined : await handle.query<{ done: number; total: number }>('progress').catch(() => undefined);

    if (statusName === 'RUNNING' || statusName === 'CONTINUED_AS_NEW') {
      return { jobId, kind, status: 'running', progress };
    }

    if (statusName === 'COMPLETED') {
      const result = (await handle.result()) as {
        document_id?: string;
        chunk_ids?: string[];
        reembedded_count?: number;
        embedded_count?: number;
      };
      return {
        jobId,
        kind,
        status: 'completed',
        progress,
        documentId: result.document_id,
        chunkCount: result.chunk_ids?.length ?? result.reembedded_count ?? result.embedded_count,
      };
    }

    try {
      await handle.result();
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause;
      return { jobId, kind, status: 'failed', progress, error: cause?.message ?? (err instanceof Error ? err.message : String(err)) };
    }
    return { jobId, kind, status: 'failed', progress, error: `workflow ended with status ${statusName}` };
  }

  private async loadRaw(documentId: string): Promise<Record<string, unknown>> {
    if (!/^[0-9a-f-]{36}$/i.test(documentId)) {
      throw new NotFoundException(`No regulatory document with document_id=${documentId}`);
    }
    const [row] = (await this.documents.query(
      `SELECT ${DOC_COLUMNS}, d.jurisdiction, d.language, d.related_typology_codes, d.retrieval_enabled, d.retrieval_priority,
              d.notes, d.source_method, d.source_file_id, d.chunking_config, d.published_by, d.published_at,
              d.withdrawn_by, d.withdrawn_at, d.withdrawal_reason, d.extracted_text IS NOT NULL AS has_extracted_text,
              (SELECT count(*)::int FROM regulatory_chunks c WHERE c.document_id = d.document_id
                 AND cardinality(c.injection_flags) > 0 AND c.injection_acknowledged_by IS NULL) AS unacknowledged_injection_count
       FROM regulatory_documents d WHERE d.document_id = $1 AND d.feature_code = $2`,
      [documentId, KB_FEATURE_CODE],
    )) as Record<string, unknown>[];
    if (!row) throw new NotFoundException(`No regulatory document with document_id=${documentId}`);
    return row;
  }
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value as string).toISOString();
}

function toRow(r: Record<string, unknown>): RegulatoryDocumentRow {
  return {
    documentId: r.document_id as string,
    documentFamilyId: r.document_family_id as string,
    versionNumber: Number(r.version_number),
    title: r.title as string,
    sourceType: r.source_type as string,
    issuingAuthority: r.issuing_authority as string,
    versionLabel: r.version_label as string,
    effectiveDate: iso(r.effective_date),
    status: r.status as DocumentStatus,
    supersededBy: (r.superseded_by as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null,
    tags: (r.tags as string[]) ?? [],
    ingestedAt: iso(r.ingested_at) as string,
    ingestedBy: r.ingested_by as string,
    chunkCount: Number(r.chunk_count),
    embeddedCount: Number(r.embedded_count),
    lastChangedAt: iso(r.last_changed_at) as string,
  };
}

function toCompareHeader(d: RegulatoryDocumentDetail) {
  return { documentId: d.documentId, versionNumber: d.versionNumber, versionLabel: d.versionLabel, status: d.status, publishedAt: d.publishedAt };
}
