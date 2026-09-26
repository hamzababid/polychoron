import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { listRegulatoryDocuments } from '../api/client';
import type { RegulatoryDocumentPage, RegulatoryDocumentStatus } from '../api/types';
import { Pagination } from '../shared/Pagination';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { StatusBadge } from './kbShared';
import { SOURCE_TYPES, STATUS_LABEL, errorMessage, formatDate, useIssuingAuthorities } from './kbUtils';
import './regulatory-kb.css';

const ALL_STATUSES: RegulatoryDocumentStatus[] = ['current', 'draft', 'superseded', 'withdrawn'];
const DEFAULT_STATUSES: RegulatoryDocumentStatus[] = ['current', 'draft'];

/** Screen 1 — Library (screens/11-regulatory-knowledge-base.md).
 * Every filter lives in the URL query so the view is bookmarkable.
 * Clicking a row navigates to the document; nothing expands inline. */
export function RegulatoryKbLibraryScreen() {
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const authorities = useIssuingAuthorities();

  const statusParam = params.get('status');
  const statuses = statusParam === null ? DEFAULT_STATUSES : (statusParam.split(',').filter(Boolean) as RegulatoryDocumentStatus[]);
  const q = params.get('q') ?? '';
  const sourceType = params.get('source_type') ?? '';
  const issuingAuthority = params.get('issuing_authority') ?? '';
  const tag = params.get('tag') ?? '';
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('page_size') ?? 25);

  const [data, setData] = useState<RegulatoryDocumentPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(q);

  const setParam = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in updates)) next.delete('page');
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setError(null);
    listRegulatoryDocuments({ status: statuses, q, sourceType, issuingAuthority, tag, page, pageSize })
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusParam, q, sourceType, issuingAuthority, tag, page, pageSize]);

  // Debounced free-text search into the URL.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => setParam({ q: search.trim() || null }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const toggleStatus = (s: RegulatoryDocumentStatus) => {
    const next = statuses.includes(s) ? statuses.filter((x) => x !== s) : [...statuses, s];
    setParam({ status: next.join(',') });
  };

  const counts = data?.statusCounts;

  return (
    <div className="kb-screen">
      <div className="stripbar">
        {ALL_STATUSES.map((s) => (
          <div key={s} className="stripbar__cell">
            <div className="microlabel">{STATUS_LABEL[s]}</div>
            <div className="stripbar__big">{counts ? counts[s] : '…'}</div>
          </div>
        ))}
        <div className="stripbar__cell kb-strip-note">
          Grounds Pattern Matching's regulatory citations — never a suspicion determination.
        </div>
        <div className="stripbar__cell kb-strip-action">
          <button className="aml-btn aml-btn--primary" onClick={() => navigate(`${base}/regulatory-kb/new`)}>
            + Add document
          </button>
        </div>
      </div>

      <div className="filterbar">
        <input className="input kb-search" placeholder="Search titles, tags, section references…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="kb-status-filter" role="group" aria-label="Status">
          {ALL_STATUSES.map((s) => (
            <label key={s} className={`filter-pill ${statuses.includes(s) ? 'kb-pill--on' : ''}`}>
              <input type="checkbox" checked={statuses.includes(s)} onChange={() => toggleStatus(s)} />
              {STATUS_LABEL[s].toLowerCase()}
            </label>
          ))}
        </div>
        <select value={sourceType} onChange={(e) => setParam({ source_type: e.target.value })}>
          <option value="">All source types</option>
          {SOURCE_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <select value={issuingAuthority} onChange={(e) => setParam({ issuing_authority: e.target.value })}>
          <option value="">All issuers</option>
          {authorities.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {tag && (
          <button className="filter-pill" onClick={() => setParam({ tag: null })}>
            tag: {tag} ×
          </button>
        )}
      </div>

      <div className="kb-scroll scrollcol">
        {error && <div className="aml-status aml-status--error">{error}</div>}
        {!error && !data && <div className="aml-status">Loading regulatory knowledge base…</div>}
        {data && (
          <>
            <table className="table kb-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Version</th>
                  <th>Source type</th>
                  <th>Issuing authority</th>
                  <th>Effective</th>
                  <th style={{ textAlign: 'right' }}>Chunks</th>
                  <th>Status</th>
                  <th>Last changed</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((d) => {
                  const embedPending = d.status === 'draft' && d.chunkCount > 0 && d.embeddedCount < d.chunkCount;
                  return (
                    <tr
                      key={d.documentId}
                      className={`kb-row kb-row--${d.status}`}
                      tabIndex={0}
                      onClick={() => navigate(`${base}/regulatory-kb/${d.documentId}`)}
                      onKeyDown={(e) => e.key === 'Enter' && navigate(`${base}/regulatory-kb/${d.documentId}`)}
                    >
                      <td>
                        <div className="kb-row__title">{d.title}</div>
                        {d.tags.length > 0 && (
                          <div className="kb-row__tags">
                            {d.tags.map((t) => (
                              <button
                                key={t}
                                className="tag tag-neutral"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setParam({ tag: t });
                                }}
                              >
                                {t}
                              </button>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>
                        v{d.versionNumber} <span className="kb-muted">· {d.versionLabel || '—'}</span>
                      </td>
                      <td>{SOURCE_TYPES.find((t) => t.value === d.sourceType)?.label ?? d.sourceType}</td>
                      <td>{d.issuingAuthority || '—'}</td>
                      <td>{formatDate(d.effectiveDate)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {d.chunkCount}
                        {embedPending && <div className="kb-muted">{d.embeddedCount} embedded</div>}
                      </td>
                      <td>
                        <StatusBadge status={d.status} />
                      </td>
                      <td>{formatDate(d.lastChangedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data.items.length === 0 && (
              <div className="kb-empty">
                {data.total === 0 && !q && !sourceType && !issuingAuthority && !tag ? (
                  <>
                    No documents yet —{' '}
                    <button className="btn btn-ghost" onClick={() => navigate(`${base}/regulatory-kb/new`)}>
                      add the first one
                    </button>
                  </>
                ) : (
                  'No documents match these filters.'
                )}
              </div>
            )}
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={(p) => setParam({ page: String(p) })}
              onPageSizeChange={(s) => setParam({ page_size: String(s) })}
            />
          </>
        )}
      </div>
    </div>
  );
}
