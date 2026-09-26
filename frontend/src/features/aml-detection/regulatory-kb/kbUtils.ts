import { useCallback, useEffect, useRef, useState } from 'react';
import { getRegulatoryJob, listIssuingAuthorities, listTypologies } from '../api/client';
import type {
  ChunkingConfig,
  IngestionJobStatus,
  RegulatoryDocumentStatus,
  RegulatoryMetadataInput,
  RegulatorySourceType,
  TypologyRow,
} from '../api/types';

/** Non-component helpers shared by the Regulatory Knowledge Base
 * screens (components live in kbShared.tsx). */

export const SOURCE_TYPES: { value: RegulatorySourceType; label: string }[] = [
  { value: 'statute', label: 'Statute' },
  { value: 'regulation', label: 'Regulation' },
  { value: 'circular', label: 'Circular' },
  { value: 'guidance', label: 'Guidance' },
  { value: 'international', label: 'International' },
];

export const STATUS_LABEL: Record<RegulatoryDocumentStatus, string> = {
  draft: 'DRAFT',
  current: 'CURRENT',
  superseded: 'SUPERSEDED',
  withdrawn: 'WITHDRAWN',
};

export const DEFAULT_CHUNKING: ChunkingConfig = {
  strategy: 'heading_pattern',
  heading_pattern: '^(Section\\s+)?\\d+[A-Z]?\\.?\\s',
  target_chunk_chars: 1200,
  max_chunk_chars: 2000,
  overlap_chars: 150,
  min_chunk_chars: 120,
  section_reference_mode: 'from_heading',
  section_reference_template: '{title} ¶{n}',
  strip_headers_footers: true,
};

export const WARNING_LABEL: Record<string, string> = {
  too_short: 'Very short',
  too_long: 'Very long',
  duplicate_section_reference: 'Duplicate reference',
};

export function formatDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Polls the one background job these screens have (embedding /
 * re-embedding) and exposes its progress. */
export function useEmbedJob(onDone: (job: IngestionJobStatus) => void) {
  const [job, setJob] = useState<IngestionJobStatus | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  });

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const track = useCallback((jobId: string) => {
    if (timer.current) clearInterval(timer.current);
    setJob({ jobId, kind: 'embed', status: 'running' });
    timer.current = setInterval(() => {
      getRegulatoryJob(jobId)
        .then((updated) => {
          setJob(updated);
          if (updated.status !== 'running') {
            if (timer.current) clearInterval(timer.current);
            onDoneRef.current(updated);
          }
        })
        .catch(() => {
          // transient — keep polling
        });
    }, 800);
  }, []);

  return { job, track, running: job?.status === 'running' };
}

export function useTypologies(): TypologyRow[] {
  const [rows, setRows] = useState<TypologyRow[]>([]);
  useEffect(() => {
    listTypologies()
      .then((o) => setRows(o.typologies))
      .catch(() => setRows([]));
  }, []);
  return rows;
}

export function useIssuingAuthorities(): string[] {
  const [rows, setRows] = useState<string[]>([]);
  useEffect(() => {
    listIssuingAuthorities()
      .then(setRows)
      .catch(() => setRows([]));
  }, []);
  return rows;
}

export interface MetadataValues {
  title: string;
  source_type: RegulatorySourceType;
  issuing_authority: string;
  version_label: string;
  effective_date: string;
  source_url: string;
  jurisdiction: string;
  language: string;
  tags: string[];
  related_typology_codes: string[];
  notes: string;
}

export interface RetrievalValues {
  retrieval_enabled: boolean;
  retrieval_priority: number;
  related_typology_codes: string[];
}

export function metadataFromDocument(d: {
  title: string;
  sourceType: RegulatorySourceType;
  issuingAuthority: string;
  versionLabel: string;
  effectiveDate: string | null;
  sourceUrl: string | null;
  jurisdiction: string;
  language: string;
  tags: string[];
  relatedTypologyCodes: string[];
  notes: string | null;
}): MetadataValues {
  return {
    title: d.title === 'Untitled draft' ? '' : d.title,
    source_type: d.sourceType,
    issuing_authority: d.issuingAuthority,
    version_label: d.versionLabel,
    effective_date: d.effectiveDate ? d.effectiveDate.slice(0, 10) : '',
    source_url: d.sourceUrl ?? '',
    jurisdiction: d.jurisdiction,
    language: d.language,
    tags: d.tags,
    related_typology_codes: d.relatedTypologyCodes,
    notes: d.notes ?? '',
  };
}

export function metadataToInput(m: MetadataValues): RegulatoryMetadataInput {
  return {
    title: m.title.trim(),
    source_type: m.source_type,
    issuing_authority: m.issuing_authority.trim(),
    version_label: m.version_label.trim(),
    effective_date: m.effective_date || null,
    source_url: m.source_url.trim() || null,
    jurisdiction: m.jurisdiction.trim() || 'PK',
    language: m.language.trim() || 'en',
    tags: m.tags,
    related_typology_codes: m.related_typology_codes,
    notes: m.notes.trim() || null,
  };
}

export function missingRequired(m: MetadataValues): string[] {
  const missing: string[] = [];
  if (!m.title.trim()) missing.push('Title');
  if (!m.issuing_authority.trim()) missing.push('Issuing authority');
  if (!m.version_label.trim()) missing.push('Version label');
  if (!m.source_url.trim()) missing.push('Source URL');
  else if (!/^https?:\/\//i.test(m.source_url.trim())) missing.push('Source URL (must start with http:// or https://)');
  return missing;
}

