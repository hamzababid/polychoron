import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getIngestionJobStatus,
  ingestRegulatoryDocument,
  listRegulatoryChunks,
  listRegulatoryDocuments,
  reembedRegulatoryDocument,
} from '../api/client';
import type { IngestionJobStatus, RegulatoryChunkRow, RegulatoryDocumentRow, RegulatorySourceType } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../shell/ToastProvider';
// Reuses Typology Console's detail-panel/dialog/muted-text classes —
// both are "console for a versioned, human-gated catalog" screens, no
// reason to duplicate that layout CSS.
import '../typology-console/typology-console.css';
import './regulatory-kb.css';

const SOURCE_TYPES: { value: RegulatorySourceType; label: string }[] = [
  { value: 'statute', label: 'Statute' },
  { value: 'regulation', label: 'Regulation' },
  { value: 'circular', label: 'Circular' },
  { value: 'guidance', label: 'Guidance' },
  { value: 'international', label: 'International' },
];

interface ChunkDraft {
  sectionReference: string;
  text: string;
}

const EMPTY_CHUNK: ChunkDraft = { sectionReference: '', text: '' };

/** specs/platform/10-regulatory-knowledge-base-spec.md's deferred
 * ingestion pipeline — TASKS.md "Regulatory Knowledge Base —
 * management screen". No dedicated screens/*.md spec exists for this
 * one (unlike the other Phase 2 consoles); layout follows Typology
 * Console's list + detail-panel + job-polling conventions since this
 * screen shares the same "console for a versioned, human-gated
 * catalog" shape.
 *
 * Chunking is deliberately manual, not an automated text-splitter:
 * the officer defines each (section_reference, text) pair directly,
 * same granularity seed_regulatory_corpus.py already hand-authors —
 * this is "plain text paste" scope, not a PDF-extraction pipeline. */
export function RegulatoryKnowledgeBaseScreen() {
  const { session } = useAuth();
  const toast = useToast();

  const [documents, setDocuments] = useState<RegulatoryDocumentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [chunks, setChunks] = useState<RegulatoryChunkRow[] | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [supersedesId, setSupersedesId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [sourceType, setSourceType] = useState<RegulatorySourceType>('guidance');
  const [issuingAuthority, setIssuingAuthority] = useState('');
  const [versionLabel, setVersionLabel] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [chunkDrafts, setChunkDrafts] = useState<ChunkDraft[]>([{ ...EMPTY_CHUNK }]);
  const [submitting, setSubmitting] = useState(false);

  const [job, setJob] = useState<IngestionJobStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(() => {
    listRegulatoryDocuments()
      .then(setDocuments)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const selectDocument = (documentId: string) => {
    setSelectedId(documentId);
    setChunks(null);
    listRegulatoryChunks(documentId)
      .then(setChunks)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
  };

  const resetForm = () => {
    setTitle('');
    setSourceType('guidance');
    setIssuingAuthority('');
    setVersionLabel('');
    setSourceUrl('');
    setChunkDrafts([{ ...EMPTY_CHUNK }]);
    setSupersedesId(null);
  };

  const openAddForm = () => {
    resetForm();
    setFormOpen(true);
  };

  const openSupersedeForm = (doc: RegulatoryDocumentRow) => {
    resetForm();
    setSupersedesId(doc.documentId);
    setTitle(doc.title);
    setSourceType(doc.sourceType);
    setIssuingAuthority(doc.issuingAuthority);
    setSourceUrl(doc.sourceUrl ?? '');
    setFormOpen(true);
  };

  const addChunkRow = () => setChunkDrafts((rows) => [...rows, { ...EMPTY_CHUNK }]);
  const removeChunkRow = (i: number) => setChunkDrafts((rows) => rows.filter((_, idx) => idx !== i));
  const updateChunkRow = (i: number, field: keyof ChunkDraft, value: string) =>
    setChunkDrafts((rows) => rows.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));

  const pollJob = (jobId: string) => {
    pollRef.current = setInterval(() => {
      void getIngestionJobStatus(jobId).then((updated) => {
        setJob(updated);
        if (updated.status !== 'running') {
          if (pollRef.current) clearInterval(pollRef.current);
          if (updated.status === 'completed') {
            toast.success(`Ingested — ${updated.chunkCount ?? 0} chunk(s) embedded.`);
            load();
          } else {
            toast.error(updated.error ?? 'Ingestion failed.');
          }
        }
      });
    }, 1200);
  };

  const canSubmit =
    title.trim() && issuingAuthority.trim() && versionLabel.trim() && chunkDrafts.every((c) => c.sectionReference.trim() && c.text.trim());

  const handleSubmit = async () => {
    if (!session || !canSubmit) return;
    setSubmitting(true);
    setJob(null);
    try {
      const { jobId } = await ingestRegulatoryDocument({
        title,
        source_type: sourceType,
        issuing_authority: issuingAuthority,
        version_label: versionLabel,
        source_url: sourceUrl.trim() || undefined,
        ingested_by: session.user.userId,
        chunks: chunkDrafts.map((c) => ({ section_reference: c.sectionReference, text: c.text })),
        supersedes_document_id: supersedesId ?? undefined,
      });
      setJob({ jobId, status: 'running' });
      pollJob(jobId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReembed = async (documentId: string) => {
    setJob(null);
    try {
      const { jobId } = await reembedRegulatoryDocument(documentId);
      setJob({ jobId, status: 'running' });
      pollJob(jobId);
      toast.success('Re-embed started.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!documents) return <div className="aml-status">Loading regulatory knowledge base…</div>;

  const selected = documents.find((d) => d.documentId === selectedId) ?? null;

  return (
    <div className="regulatory-kb">
      <div className="regulatory-kb__strip">
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>Regulatory Knowledge Base</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>
            {documents.length} document{documents.length === 1 ? '' : 's'} — grounds Pattern Matching's citations, never a suspicion
            determination
          </div>
        </div>
        <button className="aml-btn aml-btn--primary" onClick={openAddForm}>
          Add document…
        </button>
      </div>

      <div className="regulatory-kb__scroll">
        <div className="regulatory-kb__tableHead">
          <div className="regulatory-kb__ahd">Title</div>
          <div className="regulatory-kb__ahd">Source type</div>
          <div className="regulatory-kb__ahd">Issuing authority</div>
          <div className="regulatory-kb__ahd">Version</div>
          <div className="regulatory-kb__ahd" style={{ textAlign: 'right' }}>
            Chunks
          </div>
          <div className="regulatory-kb__ahd">Status</div>
        </div>

        {documents.length === 0 ? (
          <div className="typology-console__muted" style={{ padding: '18px 14px' }}>
            No documents ingested yet.
          </div>
        ) : (
          documents.map((d) => (
            <div
              key={d.documentId}
              className={`regulatory-kb__row ${selectedId === d.documentId ? 'regulatory-kb__row--selected' : ''} ${d.supersededBy ? 'regulatory-kb__row--superseded' : ''}`}
              onClick={() => selectDocument(d.documentId)}
            >
              <div className="regulatory-kb__cell">{d.title}</div>
              <div className="regulatory-kb__cell">{d.sourceType}</div>
              <div className="regulatory-kb__cell">{d.issuingAuthority}</div>
              <div className="regulatory-kb__cell">{d.versionLabel}</div>
              <div className="regulatory-kb__cell" style={{ textAlign: 'right' }}>
                {d.chunkCount}
              </div>
              <div className="regulatory-kb__cell">
                {d.supersededBy ? <span className="regulatory-kb__supersededBadge">SUPERSEDED</span> : <span style={{ color: 'var(--color-accent-800)' }}>current</span>}
              </div>
            </div>
          ))
        )}

        {selected && (
          <div className="typology-console__detail">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11 }}>
              <h5 style={{ margin: 0, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 13 }}>Document detail</h5>
              <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
                {selected.title} · {selected.versionLabel} · ingested by {selected.ingestedBy} on {new Date(selected.ingestedAt).toLocaleDateString()}
              </span>
            </div>

            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="tile-head" style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <h6 style={{ margin: 0 }}>Chunks ({chunks?.length ?? '…'})</h6>
                {selected.sourceUrl && (
                  <a href={selected.sourceUrl} target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', fontSize: 11.5 }}>
                    Source publication ↗
                  </a>
                )}
              </div>
              <div className="tile-body">
                {chunks === null ? (
                  <div className="typology-console__muted">Loading chunks…</div>
                ) : chunks.length === 0 ? (
                  <div className="typology-console__muted">No chunks yet.</div>
                ) : (
                  chunks.map((c) => (
                    <div key={c.chunkId} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--color-divider)' }}>
                      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 12.5, marginBottom: 3 }}>{c.sectionReference}</div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--color-neutral-800)' }}>{c.text}</div>
                    </div>
                  ))
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button className="aml-btn" onClick={() => void handleReembed(selected.documentId)}>
                    Re-embed chunks
                  </button>
                  {!selected.supersededBy && (
                    <button className="aml-btn" onClick={() => openSupersedeForm(selected)}>
                      Supersede with new version…
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {formOpen && (
        <div className="typology-console__dialogBackdrop">
          <div className="tile typology-console__dialog" style={{ width: 'min(680px, 94vw)', maxHeight: '85vh', overflowY: 'auto' }}>
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head" style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>
              {supersedesId ? 'Supersede with a new version' : 'Add a regulatory document'}
            </div>
            <div className="tile-body" style={{ fontSize: 13 }}>
              {supersedesId && (
                <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--color-neutral-700)' }}>
                  The current document stays in place and retained (never deleted) — it will be marked superseded once this ingests.
                </p>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="regulatory-kb__field">
                  Title
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="regulatory-kb__field">
                  Source type
                  <select value={sourceType} onChange={(e) => setSourceType(e.target.value as RegulatorySourceType)}>
                    {SOURCE_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="regulatory-kb__field">
                  Issuing authority
                  <input value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} placeholder="SBP, FMU, ..." />
                </label>
                <label className="regulatory-kb__field">
                  Version label
                  <input value={versionLabel} onChange={(e) => setVersionLabel(e.target.value)} placeholder="as amended 2026" />
                </label>
                <label className="regulatory-kb__field" style={{ gridColumn: '1 / -1' }}>
                  Source URL — the official publication a citation traces back to
                  <input value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://..." />
                </label>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span className="aml-label">Chunks — each section becomes one retrievable, embedded passage</span>
                  <button className="aml-btn" onClick={addChunkRow}>
                    + Add chunk
                  </button>
                </div>
                {chunkDrafts.map((c, i) => (
                  <div key={i} className="regulatory-kb__chunkRow">
                    <div style={{ flex: '0 0 180px' }}>
                      <label className="regulatory-kb__field">
                        Section reference
                        <input value={c.sectionReference} onChange={(e) => updateChunkRow(i, 'sectionReference', e.target.value)} placeholder="Section 7A(1)" />
                      </label>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label className="regulatory-kb__field">
                        Text
                        <textarea rows={2} value={c.text} onChange={(e) => updateChunkRow(i, 'text', e.target.value)} />
                      </label>
                    </div>
                    {chunkDrafts.length > 1 && (
                      <button className="aml-btn" style={{ marginTop: 17 }} onClick={() => removeChunkRow(i)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {job && (
                <div className="regulatory-kb__jobStatus">
                  Status: <strong>{job.status}</strong>
                  {job.status === 'failed' && job.error && <div style={{ color: 'var(--color-alert)', marginTop: 4 }}>{job.error}</div>}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button
                  className="aml-btn"
                  onClick={() => {
                    setFormOpen(false);
                    setJob(null);
                  }}
                >
                  {job?.status === 'completed' ? 'Close' : 'Cancel'}
                </button>
                <button className="aml-btn aml-btn--primary" disabled={submitting || !canSubmit || job?.status === 'running'} onClick={() => void handleSubmit()}>
                  {submitting || job?.status === 'running' ? 'Ingesting…' : 'Ingest'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
