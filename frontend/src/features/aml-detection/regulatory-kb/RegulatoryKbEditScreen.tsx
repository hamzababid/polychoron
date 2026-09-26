import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { correctRegulatoryMetadata, createRegulatoryDraft, getRegulatoryDocument } from '../api/client';
import type { RegulatoryDocumentDetail, RegulatoryMetadataInput } from '../api/types';
import { useToast } from '../../../shell/ToastProvider';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { MetadataForm, RetrievalForm, StatusBadge, Tile } from './kbShared';
import { errorMessage, metadataFromDocument, metadataToInput, type MetadataValues, type RetrievalValues } from './kbUtils';
import './regulatory-kb.css';

type Tab = 'metadata' | 'content';

/** Screen 4 — Edit (screens/11-regulatory-knowledge-base.md). Two
 * separated tabs because they have different consequences:
 * - Correct metadata: in place, reason required, one change-log row per
 *   changed field. Chunk text is never editable here.
 * - Edit content: creates a draft next version (the current one stays
 *   live until that draft is published). */
export function RegulatoryKbEditScreen() {
  const { documentId = '' } = useParams();
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'content' ? 'content' : 'metadata';

  const [doc, setDoc] = useState<RegulatoryDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<MetadataValues | null>(null);
  const [retrieval, setRetrieval] = useState<RetrievalValues | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getRegulatoryDocument(documentId)
      .then((d) => {
        if (d.status === 'draft') {
          navigate(`${base}/regulatory-kb/new?draft=${d.documentId}&step=2`, { replace: true });
          return;
        }
        setDoc(d);
        setMetadata(metadataFromDocument(d));
        setRetrieval({ retrieval_enabled: d.retrievalEnabled, retrieval_priority: d.retrievalPriority, related_typology_codes: d.relatedTypologyCodes });
      })
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [documentId, base, navigate]);

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!doc || !metadata || !retrieval) return <div className="aml-status">Loading document…</div>;

  const original = { ...metadataToInput(metadataFromDocument(doc)), retrieval_enabled: doc.retrievalEnabled, retrieval_priority: doc.retrievalPriority, related_typology_codes: doc.relatedTypologyCodes };
  const edited: RegulatoryMetadataInput = { ...metadataToInput(metadata), ...retrieval };
  const changed = Object.fromEntries(
    (Object.keys(edited) as (keyof RegulatoryMetadataInput)[])
      .filter((k) => JSON.stringify(normalize(edited[k])) !== JSON.stringify(normalize(original[k])))
      .map((k) => [k, edited[k]]),
  ) as RegulatoryMetadataInput;
  const changedCount = Object.keys(changed).length;
  const readOnly = doc.status === 'superseded';

  const saveCorrection = async () => {
    setBusy(true);
    try {
      const result = await correctRegulatoryMetadata(documentId, changed, reason.trim());
      toast.success(`Corrected ${result.changed_fields.length} field(s) — logged with your reason.`);
      navigate(`${base}/regulatory-kb/${documentId}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const startVersion = async (copyChunks: boolean) => {
    if (doc.family.draftDocumentId) {
      navigate(`${base}/regulatory-kb/new?draft=${doc.family.draftDocumentId}&step=${copyChunks ? 4 : 1}`);
      return;
    }
    setBusy(true);
    try {
      const { document_id } = await createRegulatoryDraft({
        source_method: copyChunks ? 'manual' : 'upload',
        supersedes_document_id: documentId,
        copy_chunks: copyChunks,
      });
      navigate(`${base}/regulatory-kb/new?draft=${document_id}&step=${copyChunks ? 4 : 1}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="kb-screen">
      <div className="kb-dochead">
        <div className="kb-dochead__main">
          <div className="kb-dochead__title">
            {doc.title} <StatusBadge status={doc.status} />
          </div>
          <div className="kb-muted">
            v{doc.versionNumber} · {doc.versionLabel}
          </div>
        </div>
        <div className="kb-dochead__actions">
          <Link className="aml-btn" to={`${base}/regulatory-kb/${documentId}`}>
            Back to document
          </Link>
        </div>
      </div>

      <div className="kb-tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'metadata'} className={`kb-tab ${tab === 'metadata' ? 'kb-tab--on' : ''}`} onClick={() => setParams({ tab: 'metadata' })}>
          Correct metadata
        </button>
        <button role="tab" aria-selected={tab === 'content'} className={`kb-tab ${tab === 'content' ? 'kb-tab--on' : ''}`} onClick={() => setParams({ tab: 'content' })}>
          Edit content → new version
        </button>
      </div>

      <div className="kb-scroll scrollcol">
        {tab === 'metadata' &&
          (readOnly ? (
            <div className="kb-banner kb-banner--muted">A superseded version is a historical record and can't be corrected.</div>
          ) : (
            <div className="kb-editgrid">
              <Tile title="Metadata">
                <p className="kb-muted">Corrections apply in place — they don't change retrievable text. Every changed field is logged with your reason.</p>
                <MetadataForm value={metadata} onChange={setMetadata} />
              </Tile>
              <Tile title="Retrieval settings">
                <RetrievalForm value={retrieval} onChange={setRetrieval} />
              </Tile>
              <Tile title="Reason for this correction">
                <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Title had a typo; updated the official source link" />
                <div className="kb-actions">
                  <span className="kb-muted">{changedCount ? `${changedCount} field(s) changed: ${Object.keys(changed).join(', ').replace(/_/g, ' ')}` : 'No changes yet'}</span>
                  <button className="aml-btn aml-btn--primary" disabled={busy || !changedCount || !reason.trim()} onClick={() => void saveCorrection()}>
                    {busy ? 'Saving…' : 'Save correction'}
                  </button>
                </div>
              </Tile>
            </div>
          ))}

        {tab === 'content' && (
          <Tile title="Change the document's content">
            {doc.status !== 'current' ? (
              <div className="kb-muted">Only the version in force can get a new version.</div>
            ) : (
              <>
                <p>
                  Published text is never edited in place — cases that cited it must keep resolving to exactly what they cited. Changing content creates a{' '}
                  <strong>draft next version</strong>; v{doc.versionNumber} stays in force until you publish the draft, and is then retained as superseded.
                </p>
                {doc.family.draftDocumentId && (
                  <div className="kb-callout">
                    A draft next version already exists — the options below open it rather than starting another.{' '}
                    <Link to={`${base}/regulatory-kb/${doc.family.draftDocumentId}`}>View the draft</Link>
                  </div>
                )}
                <div className="kb-choices">
                  <button className="kb-choice" disabled={busy} onClick={() => void startVersion(true)}>
                    <strong>Edit the existing chunks</strong>
                    <span className="kb-muted">Start from a copy of this version's {doc.chunkCount} chunks. Unchanged chunks keep their embeddings.</span>
                  </button>
                  <button className="kb-choice" disabled={busy} onClick={() => void startVersion(false)}>
                    <strong>Re-import from a new source</strong>
                    <span className="kb-muted">Upload, paste or fetch the amended publication and chunk it from scratch.</span>
                  </button>
                </div>
              </>
            )}
          </Tile>
        )}
      </div>
    </div>
  );
}

function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return [...v].sort();
  if (v === '' || v === undefined) return null;
  return v;
}
