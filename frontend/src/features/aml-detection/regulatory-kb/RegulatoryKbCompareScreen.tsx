import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { compareRegulatoryVersions } from '../api/client';
import type { RegulatoryCompareResult } from '../api/types';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { StatusBadge, Tile } from './kbShared';
import { errorMessage, formatDate } from './kbUtils';
import { wordDiff } from './wordDiff';
import './regulatory-kb.css';

const STATUS_ORDER = { changed: 0, added: 1, removed: 2, unchanged: 3 } as const;

/** Screen 5 — Version compare (screens/11-regulatory-knowledge-base.md):
 * metadata diff + chunk-level diff matched by section reference, with
 * word-level highlights inside changed chunks. */
export function RegulatoryKbCompareScreen() {
  const { documentId = '', otherId = '' } = useParams();
  const base = useFeatureBasePath();
  const [data, setData] = useState<RegulatoryCompareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);

  useEffect(() => {
    compareRegulatoryVersions(documentId, otherId)
      .then(setData)
      .catch((err: unknown) => setError(errorMessage(err)));
  }, [documentId, otherId]);

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!data) return <div className="aml-status">Comparing versions…</div>;

  const counts = data.chunks.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.status]: (acc[c.status] ?? 0) + 1 }), {});
  const shown = [...data.chunks]
    .filter((c) => showUnchanged || c.status !== 'unchanged')
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

  return (
    <div className="kb-screen">
      <div className="stripbar">
        {[data.older, data.newer].map((v, i) => (
          <div key={v.documentId} className="stripbar__cell">
            <div className="microlabel">{i === 0 ? 'Older' : 'Newer'}</div>
            <div>
              <Link to={`${base}/regulatory-kb/${v.documentId}`}>v{v.versionNumber}</Link> <StatusBadge status={v.status} />
            </div>
            <div className="kb-muted">
              {v.versionLabel} · published {formatDate(v.publishedAt)}
            </div>
          </div>
        ))}
        <div className="stripbar__cell">
          <div className="microlabel">Chunks</div>
          <div>
            {counts.changed ?? 0} changed · {counts.added ?? 0} added · {counts.removed ?? 0} removed · {counts.unchanged ?? 0} unchanged
          </div>
        </div>
      </div>

      <div className="kb-scroll scrollcol">
        <Tile title="Metadata">
          {data.metadata.length === 0 ? (
            <div className="kb-muted">No metadata differences.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>v{data.older.versionNumber}</th>
                  <th>v{data.newer.versionNumber}</th>
                </tr>
              </thead>
              <tbody>
                {data.metadata.map((m) => (
                  <tr key={m.field}>
                    <td>{m.field.replace(/([A-Z])/g, ' $1').toLowerCase()}</td>
                    <td className="kb-diff-del">{display(m.older)}</td>
                    <td className="kb-diff-ins">{display(m.newer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Tile>

        <Tile
          title="Chunks"
          actions={
            <label className="kb-toggle">
              <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} /> Show unchanged
            </label>
          }
        >
          {shown.length === 0 && <div className="kb-muted">No content differences.</div>}
          {shown.map((c, i) => (
            <div key={`${c.sectionReference}-${i}`} className={`kb-diffchunk kb-diffchunk--${c.status}`}>
              <div className="kb-diffchunk__head">
                <span className={`kb-diffchunk__badge kb-diffchunk__badge--${c.status}`}>{c.status}</span>
                <strong>{c.sectionReference}</strong>
              </div>
              {c.status === 'changed' ? (
                <div className="kb-diffchunk__text">
                  {wordDiff(c.olderText ?? '', c.newerText ?? '').map((p, j) => (
                    <span key={j} className={p.type === 'del' ? 'kb-diff-del' : p.type === 'ins' ? 'kb-diff-ins' : undefined}>
                      {p.text}
                    </span>
                  ))}
                </div>
              ) : (
                <div className={`kb-diffchunk__text ${c.status === 'removed' ? 'kb-diff-del' : c.status === 'added' ? 'kb-diff-ins' : ''}`}>
                  {c.newerText ?? c.olderText}
                </div>
              )}
            </div>
          ))}
        </Tile>
      </div>
    </div>
  );
}

function display(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDate(v);
  return String(v);
}
