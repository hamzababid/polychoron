import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  discardRegulatoryDraft,
  downloadRegulatorySourceFile,
  embedRegulatoryDraft,
  getRegulatoryDocument,
  listRegulatoryChanges,
  listRegulatoryChunks,
  listRegulatoryCitations,
  listRegulatoryVersions,
  previewRegulatoryRetrieval,
  publishRegulatoryDraft,
  reembedRegulatoryDocument,
  withdrawRegulatoryDocument,
} from '../api/client';
import type {
  RegulatoryChunkRow,
  RegulatoryCitationRow,
  RegulatoryDocumentChange,
  RegulatoryDocumentDetail,
  RegulatoryDocumentRow,
  RetrievalPreviewResult,
} from '../api/types';
import { useToast } from '../../../shell/ToastProvider';
import { Pagination } from '../shared/Pagination';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { ConfirmDialog, JobProgress, StatusBadge, Tile } from './kbShared';
import { SOURCE_TYPES, WARNING_LABEL, errorMessage, formatBytes, formatDate, useEmbedJob } from './kbUtils';
import './regulatory-kb.css';

type Dialog = null | 'withdraw' | 'discard' | 'publish';

/** Screen 3 — Document view (screens/11-regulatory-knowledge-base.md).
 * A superseded or withdrawn version is read-only and links forward to
 * the version in force; its chunks stay exactly as they were cited. */
export function RegulatoryKbDocumentScreen() {
  const { documentId = '' } = useParams();
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const toast = useToast();

  const [doc, setDoc] = useState<RegulatoryDocumentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chunks, setChunks] = useState<RegulatoryChunkRow[] | null>(null);
  const [chunkQuery, setChunkQuery] = useState('');
  const [versions, setVersions] = useState<RegulatoryDocumentRow[]>([]);
  const [changes, setChanges] = useState<RegulatoryDocumentChange[]>([]);
  const [citations, setCitations] = useState<{ total: number; items: RegulatoryCitationRow[] } | null>(null);
  const [citationPage, setCitationPage] = useState(1);
  const [citationPageSize, setCitationPageSize] = useState(10);
  const [compareWith, setCompareWith] = useState<string>('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RetrievalPreviewResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [publishAfterEmbed, setPublishAfterEmbed] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getRegulatoryDocument(documentId)
      .then(setDoc)
      .catch((err: unknown) => setError(errorMessage(err)));
    listRegulatoryVersions(documentId)
      .then(setVersions)
      .catch(() => setVersions([]));
    listRegulatoryChanges(documentId)
      .then(setChanges)
      .catch(() => setChanges([]));
  }, [documentId]);

  useEffect(() => {
    setDoc(null);
    setResults(null);
    load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      listRegulatoryChunks(documentId, chunkQuery.trim() || undefined)
        .then(setChunks)
        .catch((err: unknown) => toast.error(errorMessage(err)));
    }, 250);
    return () => clearTimeout(t);
  }, [documentId, chunkQuery, toast]);

  useEffect(() => {
    listRegulatoryCitations(documentId, citationPage, citationPageSize)
      .then(setCitations)
      .catch(() => setCitations({ total: 0, items: [] }));
  }, [documentId, citationPage, citationPageSize]);

  const { job, track, running } = useEmbedJob((finished) => {
    load();
    listRegulatoryChunks(documentId).then(setChunks).catch(() => undefined);
    if (finished.status !== 'completed') {
      toast.error(finished.error ?? 'Embedding failed.');
      setPublishAfterEmbed(false);
      return;
    }
    toast.success(finished.kind === 'reembed' ? 'Re-embedding complete.' : 'All chunks embedded.');
    if (publishAfterEmbed) {
      setPublishAfterEmbed(false);
      void publish();
    }
  });

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!doc) return <div className="aml-status">Loading document…</div>;

  const isDraft = doc.status === 'draft';
  const isCurrent = doc.status === 'current';
  const needsEmbedding = doc.embeddedCount < doc.chunkCount;
  const publishBlockers = [
    !doc.title || doc.title === 'Untitled draft' ? 'a title' : null,
    !doc.issuingAuthority ? 'an issuing authority' : null,
    !doc.versionLabel ? 'a version label' : null,
    !doc.sourceUrl ? 'a source URL' : null,
    doc.chunkCount === 0 ? 'at least one chunk' : null,
    doc.unacknowledgedInjectionCount > 0 ? 'acknowledged injection flags' : null,
  ].filter(Boolean) as string[];

  async function publish() {
    setBusy(true);
    try {
      const result = await publishRegulatoryDraft(documentId);
      toast.success(result.superseded_document_id ? 'Published — the previous version is superseded and retained.' : 'Published.');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setDialog(null);
    }
  }

  const startPublish = async () => {
    setDialog(null);
    if (needsEmbedding) {
      setPublishAfterEmbed(true);
      try {
        track((await embedRegulatoryDraft(documentId)).jobId);
      } catch (err) {
        setPublishAfterEmbed(false);
        toast.error(errorMessage(err));
      }
      return;
    }
    await publish();
  };

  const runAction = async (action: () => Promise<unknown>, success: string, after?: () => void) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      setDialog(null);
      setReason('');
      if (after) after();
      else load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const runRetrieval = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await previewRegulatoryRetrieval({ query: query.trim(), top_k: 8, include_draft_document_id: isDraft ? documentId : undefined });
      setResults(res.results);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  const olderVersions = versions.filter((v) => v.documentId !== documentId);

  return (
    <div className="kb-screen">
      <div className="kb-dochead">
        <div className="kb-dochead__main">
          <div className="kb-dochead__title">
            {doc.title}
            <StatusBadge status={doc.status} />
          </div>
          <div className="kb-muted">
            v{doc.versionNumber} · {doc.versionLabel || '—'} · {doc.issuingAuthority || '—'} ·{' '}
            {SOURCE_TYPES.find((t) => t.value === doc.sourceType)?.label ?? doc.sourceType}
            {doc.sourceUrl && (
              <>
                {' · '}
                <a href={doc.sourceUrl} target="_blank" rel="noreferrer">
                  Source publication ↗
                </a>
              </>
            )}
          </div>
        </div>
        <div className="kb-dochead__actions">
          {isDraft && (
            <>
              <button className="aml-btn" onClick={() => navigate(`${base}/regulatory-kb/new?draft=${documentId}&step=${doc.chunkCount ? 4 : 1}`)}>
                Continue editing
              </button>
              <button className="aml-btn kb-danger" onClick={() => setDialog('discard')}>
                Discard draft
              </button>
              <button className="aml-btn aml-btn--primary" disabled={publishBlockers.length > 0 || running || busy} onClick={() => setDialog('publish')}>
                {needsEmbedding ? 'Embed & publish…' : 'Publish…'}
              </button>
            </>
          )}
          {isCurrent && (
            <>
              <button className="aml-btn" onClick={() => navigate(`${base}/regulatory-kb/${documentId}/edit?tab=metadata`)}>
                Edit metadata
              </button>
              <button className="aml-btn" onClick={() => navigate(`${base}/regulatory-kb/${documentId}/edit?tab=content`)}>
                New version
              </button>
              <button className="aml-btn" disabled={running} onClick={() => void reembedRegulatoryDocument(documentId).then((r) => track(r.jobId)).catch((e: unknown) => toast.error(errorMessage(e)))}>
                Re-embed
              </button>
              <button className="aml-btn kb-danger" onClick={() => setDialog('withdraw')}>
                Withdraw…
              </button>
            </>
          )}
          {!isDraft && !isCurrent && doc.family.currentDocumentId && (
            <Link className="aml-btn" to={`${base}/regulatory-kb/${doc.family.currentDocumentId}`}>
              Go to the version in force →
            </Link>
          )}
        </div>
      </div>

      {isDraft && publishBlockers.length > 0 && (
        <div className="kb-banner">Draft — never visible to agents. Before publishing it needs {publishBlockers.join(', ')}.</div>
      )}
      {isDraft && publishBlockers.length === 0 && <div className="kb-banner">Draft — never visible to agents until published.</div>}
      {doc.status === 'superseded' && (
        <div className="kb-banner kb-banner--muted">Superseded — retained so cases decided under this version stay explainable against it. Read-only.</div>
      )}
      {doc.status === 'withdrawn' && (
        <div className="kb-banner kb-banner--muted">
          Withdrawn on {formatDate(doc.withdrawnAt)} by {doc.withdrawnBy}: “{doc.withdrawalReason}”. Retained, never retrieved. Read-only.
        </div>
      )}
      {doc.family.draftDocumentId && doc.family.draftDocumentId !== documentId && (
        <div className="kb-banner">
          A new version is in progress —{' '}
          <Link to={`${base}/regulatory-kb/${doc.family.draftDocumentId}`}>open the draft</Link>.
        </div>
      )}

      <div className="kb-scroll scrollcol">
        <JobProgress job={job} label={job?.kind === 'reembed' ? 'Re-embedding' : 'Embedding'} />

        <div className="kb-docgrid">
          <div className="kb-docgrid__main">
            <Tile
              title={`Chunks (${doc.chunkCount})`}
              actions={<input className="input kb-chunk-search" placeholder="Search within this document…" value={chunkQuery} onChange={(e) => setChunkQuery(e.target.value)} />}
            >
              {chunks === null ? (
                <div className="aml-status">Loading chunks…</div>
              ) : chunks.length === 0 ? (
                <div className="kb-muted">{chunkQuery ? 'No chunks match.' : 'No chunks yet.'}</div>
              ) : (
                chunks.map((c) => (
                  <div key={c.chunkId} className="kb-viewchunk">
                    <div className="kb-viewchunk__head">
                      <span className="kb-chunk__ordinal">{c.ordinal}</span>
                      <span className="kb-viewchunk__ref">{c.sectionReference}</span>
                      {!c.embedded && <span className="tag kb-warn">not embedded</span>}
                      {c.injectionFlags.length > 0 && (
                        <span className={`tag ${c.injectionAcknowledged ? 'tag-neutral' : 'tag-alert'}`}>
                          {c.injectionAcknowledged ? 'injection flag acknowledged' : 'injection flag'}
                        </span>
                      )}
                      {c.warnings.map((w) => (
                        <span key={w} className="tag kb-warn">
                          {WARNING_LABEL[w] ?? w}
                        </span>
                      ))}
                      <span className="kb-muted kb-viewchunk__cited">
                        {c.citedByCaseCount ? `cited by ${c.citedByCaseCount} case${c.citedByCaseCount === 1 ? '' : 's'}` : 'not cited yet'}
                      </span>
                    </div>
                    <div className="kb-viewchunk__text">{c.text}</div>
                  </div>
                ))
              )}
            </Tile>

            <Tile title="Test retrieval">
              <p className="kb-muted">
                Ranks passages exactly as the Pattern Matching agent would (similarity × priority).
                {isDraft && ' This draft is included here for testing only — agents never see it.'}
              </p>
              <div className="kb-inline">
                <input
                  className="input"
                  placeholder="e.g. several cash deposits just under the reporting threshold"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void runRetrieval()}
                />
                <button className="aml-btn aml-btn--primary" disabled={searching || !query.trim() || (isDraft && needsEmbedding)} onClick={() => void runRetrieval()}>
                  {searching ? 'Searching…' : 'Test'}
                </button>
              </div>
              {isDraft && needsEmbedding && <div className="kb-muted">Embed this draft’s chunks first to test it.</div>}
              {results && (
                <ol className="kb-results">
                  {results.length === 0 && <li className="kb-muted">No passages retrieved.</li>}
                  {results.map((r) => (
                    <li key={r.chunk_id} className={r.document_id === documentId ? 'kb-results__mine' : ''}>
                      <div className="kb-results__head">
                        <span className="kb-results__score">{r.score.toFixed(3)}</span>
                        <strong>{r.section_reference}</strong>
                        <span className="kb-muted">
                          {r.document_title}
                          {r.document_id === documentId ? ' (this document)' : ''}
                        </span>
                      </div>
                      <div className="kb-results__text">{r.text}</div>
                    </li>
                  ))}
                </ol>
              )}
            </Tile>

            <Tile title={`Cited by ${citations?.total ?? '…'} case${citations?.total === 1 ? '' : 's'}`}>
              {!citations ? (
                <div className="aml-status">Loading…</div>
              ) : citations.total === 0 ? (
                <div className="kb-muted">No cases cite this document yet.</div>
              ) : (
                <>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Case</th>
                        <th>Customer</th>
                        <th>Typology</th>
                        <th>Sections cited</th>
                        <th>Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {citations.items.map((c) => (
                        <tr key={c.caseId}>
                          <td>
                            <Link to={`${base}/cases/${c.caseId}`}>{c.sourceAlertId}</Link>
                            <div className="kb-muted">{c.caseStatus}</div>
                          </td>
                          <td>{c.customerId}</td>
                          <td>{c.typologyLabel}</td>
                          <td>{c.citedSections.join('; ')}</td>
                          <td>{formatDate(c.matchedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination
                    page={citationPage}
                    pageSize={citationPageSize}
                    total={citations.total}
                    onPageChange={setCitationPage}
                    onPageSizeChange={(s) => {
                      setCitationPageSize(s);
                      setCitationPage(1);
                    }}
                  />
                </>
              )}
            </Tile>
          </div>

          <div className="kb-docgrid__side">
            <Tile title="Metadata">
              <dl className="kb-dl">
                <dt>Effective</dt>
                <dd>{formatDate(doc.effectiveDate)}</dd>
                <dt>Jurisdiction · language</dt>
                <dd>
                  {doc.jurisdiction} · {doc.language}
                </dd>
                <dt>Tags</dt>
                <dd>
                  {doc.tags.length
                    ? doc.tags.map((t) => (
                        <span key={t} className="tag tag-neutral kb-tagspace">
                          {t}
                        </span>
                      ))
                    : '—'}
                </dd>
                <dt>Agents</dt>
                <dd>
                  {doc.retrievalEnabled ? 'available' : 'not available'} · priority {doc.retrievalPriority.toFixed(1)}×
                </dd>
                <dt>Typologies</dt>
                <dd>{doc.relatedTypologyCodes.length ? doc.relatedTypologyCodes.join(', ') : 'all'}</dd>
                <dt>Created</dt>
                <dd>
                  {doc.ingestedBy} · {formatDate(doc.ingestedAt, true)}
                </dd>
                {doc.publishedAt && (
                  <>
                    <dt>Published</dt>
                    <dd>
                      {doc.publishedBy} · {formatDate(doc.publishedAt, true)}
                    </dd>
                  </>
                )}
                <dt>Source</dt>
                <dd>
                  {doc.sourceMethod}
                  {doc.sourceFile && (
                    <>
                      <br />
                      <button
                        className="btn btn-ghost"
                        onClick={() => void downloadRegulatorySourceFile(documentId, doc.sourceFile!.filename).catch((e: unknown) => toast.error(errorMessage(e)))}
                      >
                        {doc.sourceFile.filename} ({formatBytes(doc.sourceFile.sizeBytes)}) ↓
                      </button>
                      <div className="kb-muted kb-mono" title="sha256">
                        {doc.sourceFile.sha256.slice(0, 16)}…
                      </div>
                    </>
                  )}
                </dd>
                {doc.chunkingConfig && (
                  <>
                    <dt>Chunking</dt>
                    <dd>
                      {String(doc.chunkingConfig.strategy).replace('_', ' ')}
                      {doc.chunkingConfig.heading_pattern ? <span className="kb-mono"> {doc.chunkingConfig.heading_pattern}</span> : null}
                    </dd>
                  </>
                )}
                {doc.notes && (
                  <>
                    <dt>Internal notes</dt>
                    <dd className="kb-prewrap">{doc.notes}</dd>
                  </>
                )}
              </dl>
            </Tile>

            <Tile title="Version history">
              <ol className="kb-timeline">
                {versions.map((v) => (
                  <li key={v.documentId} className={v.documentId === documentId ? 'kb-timeline__me' : ''}>
                    <div>
                      {v.documentId === documentId ? <strong>v{v.versionNumber}</strong> : <Link to={`${base}/regulatory-kb/${v.documentId}`}>v{v.versionNumber}</Link>}{' '}
                      <StatusBadge status={v.status} />
                    </div>
                    <div className="kb-muted">
                      {v.versionLabel || '—'} · {formatDate(v.lastChangedAt)}
                    </div>
                  </li>
                ))}
              </ol>
              {olderVersions.length > 0 && (
                <div className="kb-inline">
                  <select className="input" value={compareWith} onChange={(e) => setCompareWith(e.target.value)}>
                    <option value="">Compare with…</option>
                    {olderVersions.map((v) => (
                      <option key={v.documentId} value={v.documentId}>
                        v{v.versionNumber} · {v.status}
                      </option>
                    ))}
                  </select>
                  <button className="aml-btn" disabled={!compareWith} onClick={() => navigate(`${base}/regulatory-kb/${documentId}/compare/${compareWith}`)}>
                    Compare
                  </button>
                </div>
              )}
            </Tile>

            <Tile title="Metadata change log">
              {changes.length === 0 ? (
                <div className="kb-muted">No corrections recorded.</div>
              ) : (
                <ul className="kb-changes">
                  {changes.map((c) => (
                    <li key={c.changeId}>
                      <div>
                        <strong>{c.fieldName.replace(/_/g, ' ')}</strong>: <span className="kb-strike">{c.oldValue ?? '—'}</span> → {c.newValue ?? '—'}
                      </div>
                      <div className="kb-muted">
                        {c.changedBy} · {formatDate(c.changedAt, true)} · “{c.reason}”
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Tile>
          </div>
        </div>
      </div>

      {dialog === 'withdraw' && (
        <ConfirmDialog
          title="Withdraw this document?"
          confirmLabel="Withdraw"
          busy={busy}
          disabled={!reason.trim()}
          onCancel={() => setDialog(null)}
          onConfirm={() => void runAction(() => withdrawRegulatoryDocument(documentId, reason.trim()), 'Withdrawn — retained, no longer retrieved.')}
        >
          <p>Use this when the regulation is repealed with no replacement. It stops being retrieved, but is retained so past cases stay explainable.</p>
          <div className="field">
            <label>Reason (required)</label>
            <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
      {dialog === 'discard' && (
        <ConfirmDialog
          title="Discard this draft?"
          confirmLabel="Discard draft"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() =>
            void runAction(() => discardRegulatoryDraft(documentId), 'Draft discarded.', () =>
              navigate(doc.family.currentDocumentId ? `${base}/regulatory-kb/${doc.family.currentDocumentId}` : `${base}/regulatory-kb`),
            )
          }
        >
          The draft and its chunks are deleted. Drafts were never visible to agents, so nothing can cite them.
        </ConfirmDialog>
      )}
      {dialog === 'publish' && (
        <ConfirmDialog title="Publish this document?" confirmLabel={needsEmbedding ? 'Embed & publish' : 'Publish'} busy={busy} onCancel={() => setDialog(null)} onConfirm={() => void startPublish()}>
          <p>
            <strong>{doc.chunkCount}</strong> chunk(s) become {doc.retrievalEnabled ? 'retrievable and citable by agents' : 'current (agent access is off)'}.
          </p>
          {doc.family.currentDocumentId && <p>The version in force becomes superseded — retained, never deleted.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
