import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { RegressionRun, TypologyHistory, TypologyVersion } from '../api/types';
import { wordDiff } from '../regulatory-kb/wordDiff';
import { Tile } from '../regulatory-kb/kbShared';
import { Pagination } from '../shared/Pagination';
import { usePagedList } from '../shared/usePagedList';
import { formatDate, isRunning } from './typologyUtils';

/** Shared pieces of the Typology Console's routed screens
 * (specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md).
 * Tile / ConfirmDialog / wordDiff come from the KB screens — the same
 * design-system building blocks, not a second copy. */

/** Live content: solid rail. Draft: hatched grey. A rule affecting
 * production never looks like one that isn't (screen spec, States). */
export function VersionTile({
  kind,
  title,
  note,
  actions,
  children,
}: {
  kind: 'live' | 'draft';
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Tile
      className={`typology-version typology-version--${kind}`}
      title={title}
      actions={
        <>
          {note && <span className="typology-muted">{note}</span>}
          {actions}
        </>
      }
    >
      {children}
    </Tile>
  );
}

export function VersionContent({ version }: { version: TypologyVersion }) {
  return (
    <>
      <div className="typology-detail__label">
        {version.typologyLabel}
        {!version.active && <span className="typology-status typology-status--retired" style={{ marginLeft: 8 }}>INACTIVE</span>}
      </div>
      <p className="typology-detail__text">{version.ruleLogicDescription}</p>
      <div className="typology-muted">
        {version.changedBy}, {formatDate(version.changedAt)} — “{version.changeReason || 'no reason yet'}”
      </div>
    </>
  );
}

export function DiffText({ older, newer }: { older: string; newer: string }) {
  return (
    <p className="typology-detail__text">
      {wordDiff(older, newer).map((p, i) => (
        <span key={i} className={p.type === 'del' ? 'typology-diff-del' : p.type === 'ins' ? 'typology-diff-ins' : undefined}>
          {p.text}
        </span>
      ))}
    </p>
  );
}

/** Label, active flag and rule text of `newer` against `older`. */
export function VersionDiff({ older, newer }: { older: TypologyVersion; newer: TypologyVersion }) {
  const labelChanged = older.typologyLabel !== newer.typologyLabel;
  const textChanged = older.ruleLogicDescription !== newer.ruleLogicDescription;
  const activeChanged = older.active !== newer.active;
  if (!labelChanged && !textChanged && !activeChanged) return <div className="typology-muted">No differences.</div>;
  return (
    <>
      {activeChanged && <div className="typology-detail__diffNote">{newer.active ? 'Re-activates the typology.' : 'Retires the typology.'}</div>}
      {labelChanged && (
        <>
          <div className="aml-label">Label</div>
          <DiffText older={older.typologyLabel} newer={newer.typologyLabel} />
        </>
      )}
      {textChanged && (
        <>
          <div className="aml-label">Rule logic</div>
          <DiffText older={older.ruleLogicDescription} newer={newer.ruleLogicDescription} />
        </>
      )}
    </>
  );
}

export function ChecklistItem({ ok, optional, title, children }: { ok: boolean; optional?: boolean; title: string; children: ReactNode }) {
  const mark = ok ? '✓' : optional ? '–' : '✗';
  return (
    <li className={`typology-detail__item ${ok ? 'typology-detail__item--ok' : optional ? '' : 'typology-detail__item--todo'}`}>
      <span className="typology-detail__mark">{mark}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', marginTop: 2 }}>{children}</div>
      </div>
    </li>
  );
}

export function RegressionSummary({ run }: { run: RegressionRun }) {
  return (
    <>
      Status: <strong>{run.status}</strong>
      {run.total != null && ` · ${run.done}/${run.total} cases`}
      {!isRunning(run) && run.total != null && ` · ${run.passed} passed, ${run.failed} failed`}
      {run.stale && <span className="typology-detail__stale"> STALE — the draft changed after this run</span>}
    </>
  );
}

export function RegressionResults({ run }: { run: RegressionRun }) {
  const paging = usePagedList(run.results, { resetKey: run.runId });
  return (
    <>
      <table className="typology-detail__results">
        <thead>
          <tr>
            <th>Case</th>
            <th>Expected</th>
            <th>Actual</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {paging.pageItems.map((r) => (
            <tr key={r.scenarioName}>
              <td>{r.scenarioName}</td>
              <td>
                {r.expectedTypology ?? 'any'} · {r.expectedRecommendation ?? 'any'}
              </td>
              <td>
                {r.actualTypology ?? '—'} · {r.actualRecommendation ?? '—'}
                {r.notes && <div className="typology-muted">{r.notes}</div>}
              </td>
              <td style={{ color: r.matchedExpected ? 'var(--color-accent-800)' : 'var(--color-alert)' }}>{r.matchedExpected ? 'pass' : 'fail'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {paging.needed && <Pagination {...paging.props} noun="Cases" />}
    </>
  );
}

export function HistoryTile({
  code,
  base,
  history,
  productionVersion,
}: {
  code: string;
  base: string;
  history: TypologyHistory;
  productionVersion: number | null;
}) {
  const promotionsByVersion = new Map(history.promotions.map((p) => [p.promotedVersion, p]));
  const paging = usePagedList(history.versions, { resetKey: code });
  return (
    <Tile
      title="Version history"
      actions={
        <span className="tag tag-neutral" style={{ fontSize: 10 }}>
          {history.versions.length} versions · {history.promotions.length} promotions
        </span>
      }
    >
      <div style={{ margin: '-11px -13px -13px' }}>
        {paging.pageItems.map((v) => {
          const promotion = promotionsByVersion.get(v.version);
          const compareTarget = productionVersion != null && v.version !== productionVersion ? productionVersion : null;
          return (
            <div key={v.version} className={`typology-history__row ${v.version === productionVersion ? 'typology-history__row--live' : ''}`}>
              <div style={{ flex: 'none', width: 56 }}>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>v{v.version}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>{formatDate(v.changedAt)}</div>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{v.changeReason || <em>no reason yet</em>}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 1 }}>
                  {v.changedBy} · {v.active ? 'active' : 'inactive'}
                  {v.status === 'discarded' && ` · discarded by ${v.discardedBy}: “${v.discardReason}”`}
                </div>
                {promotion && (
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-700)', marginTop: 2 }}>
                    Promoted by {promotion.promotedBy}, {formatDate(promotion.promotedAt)} — “{promotion.reason}” ·{' '}
                    {promotion.preV2 ? 'before regression gating' : `regression ${promotion.evalRunId?.slice(0, 8)}`} ·{' '}
                    {promotion.backtestJobId ? (
                      `backtest ${promotion.backtestJobId.slice(0, 8)}`
                    ) : (
                      <span style={{ color: 'var(--color-alert)' }}>no backtest</span>
                    )}
                  </div>
                )}
                {compareTarget != null && (
                  <Link
                    className="typology-history__compare"
                    to={`${base}/typologies/${code}/compare/${Math.min(v.version, compareTarget)}/${Math.max(v.version, compareTarget)}`}
                  >
                    Compare with live v{compareTarget} →
                  </Link>
                )}
              </div>
              <span className={`typology-history__status typology-history__status--${v.status}`}>{v.status}</span>
            </div>
          );
        })}
      </div>
      {paging.needed && (
        <div style={{ margin: '13px -13px -13px' }}>
          <Pagination {...paging.props} noun="Versions" />
        </div>
      )}
    </Tile>
  );
}
