import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { Client } from '@temporalio/client';
import { RegulatoryChunk, RegulatoryDocument } from '../../../platform/entities/index.js';
import { TEMPORAL_CLIENT } from '../../../common/temporal/temporal.module.js';
import { IngestRegulatoryDocumentDto } from '../dto/ingest-regulatory-document.dto.js';

const FEATURE_CODE = 'aml_detection';
const TASK_QUEUE = 'aml_detection-task-queue';

export interface RegulatoryDocumentRow {
  documentId: string;
  title: string;
  sourceType: string;
  issuingAuthority: string;
  versionLabel: string;
  effectiveDate: string | null;
  supersededBy: string | null;
  sourceUrl: string | null;
  ingestedAt: string;
  ingestedBy: string;
  chunkCount: number;
}

export interface RegulatoryChunkRow {
  chunkId: string;
  sectionReference: string;
  text: string;
}

export interface IngestionJobStatus {
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  documentId?: string;
  chunkCount?: number;
  error?: string;
}

/** specs/platform/10-regulatory-knowledge-base-spec.md's deferred
 * ingestion pipeline (management screen). Reads go straight to
 * Postgres (agent-service owns these tables' writes, both services
 * read freely per specs/platform/09-backend-service-boundary-spec.md).
 * Writes go through a Temporal workflow running on the agent-service
 * worker — chunking a document means generating embeddings, and
 * NestJS never calls an LLM directly, same boundary alert ingestion
 * already respects. No direct app-api -> agent-service HTTP call
 * anywhere in this file. */
@Injectable()
export class RegulatoryKbService {
  constructor(
    @InjectRepository(RegulatoryDocument) private readonly documents: Repository<RegulatoryDocument>,
    @InjectRepository(RegulatoryChunk) private readonly chunks: Repository<RegulatoryChunk>,
    @Inject(TEMPORAL_CLIENT) private readonly temporalClient: Client,
  ) {}

  async listDocuments(): Promise<RegulatoryDocumentRow[]> {
    const rows = await this.documents.find({ where: { featureCode: FEATURE_CODE }, order: { ingestedAt: 'DESC' } });
    const counts = await Promise.all(rows.map((d) => this.chunks.count({ where: { documentId: d.documentId } })));

    return rows.map((d, i) => ({
      documentId: d.documentId,
      title: d.title,
      sourceType: d.sourceType,
      issuingAuthority: d.issuingAuthority,
      versionLabel: d.versionLabel,
      effectiveDate: d.effectiveDate ? d.effectiveDate.toISOString() : null,
      supersededBy: d.supersededBy ?? null,
      sourceUrl: d.sourceUrl ?? null,
      ingestedAt: d.ingestedAt.toISOString(),
      ingestedBy: d.ingestedBy,
      chunkCount: counts[i],
    }));
  }

  async listChunks(documentId: string): Promise<RegulatoryChunkRow[]> {
    const document = await this.documents.findOneBy({ documentId });
    if (!document) {
      throw new NotFoundException(`No regulatory document with document_id=${documentId}`);
    }
    const rows = await this.chunks.find({ where: { documentId }, order: { sectionReference: 'ASC' } });
    return rows.map((c) => ({ chunkId: c.chunkId, sectionReference: c.sectionReference, text: c.text }));
  }

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
          feature_code: FEATURE_CODE,
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

  async startReembed(documentId: string): Promise<{ jobId: string }> {
    const document = await this.documents.findOneBy({ documentId });
    if (!document) {
      throw new NotFoundException(`No regulatory document with document_id=${documentId}`);
    }

    const jobId = `regulatory-reembed-${randomUUID()}`;
    await this.temporalClient.workflow.start('RegulatoryReembedWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: jobId,
      args: [{ document_id: documentId }],
    });

    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<IngestionJobStatus> {
    const handle = this.temporalClient.workflow.getHandle(jobId);
    const description = await handle.describe();
    const statusName = description.status.name;

    if (statusName === 'RUNNING' || statusName === 'CONTINUED_AS_NEW') {
      return { jobId, status: 'running' };
    }

    if (statusName === 'COMPLETED') {
      const result = (await handle.result()) as { document_id?: string; chunk_ids?: string[]; reembedded_count?: number };
      return {
        jobId,
        status: 'completed',
        documentId: result.document_id,
        chunkCount: result.chunk_ids?.length ?? result.reembedded_count,
      };
    }

    try {
      await handle.result();
    } catch (err) {
      return { jobId, status: 'failed', error: err instanceof Error ? err.message : String(err) };
    }
    return { jobId, status: 'failed', error: `workflow ended with status ${statusName}` };
  }
}
