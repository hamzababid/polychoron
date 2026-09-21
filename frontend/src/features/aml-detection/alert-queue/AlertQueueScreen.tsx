import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { claimAlert, getDashboardSummary, listAlerts } from '../api/client';
import type { AlertQueueRow, CaseStatus, DashboardSummary, RiskTier } from '../api/types';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './alert-queue.css';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];

const RISK_TIERS: RiskTier[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: CaseStatus[] = ['open', 'claimed', 'investigating', 'escalated', 'pending_filing', 'cleared', 'filed'];
const TIER_COLOR: Record<RiskTier, string> = {
  critical: 'var(--color-alert)',
  high: 'var(--color-accent-700)',
  medium: 'var(--color-accent-400)',
  low: 'var(--color-neutral-400)',
};

/** specs/suites/bfsi/features/aml-detection/screens/02-alert-queue.md
 * Restyled to match design-exports/.../Alert Queue.dc.html's dense
 * data-grid language. Filters drive server-side query params (never
 * client-filter a fully-loaded list); sort order is fixed (risk score
 * desc, then created_at desc) and only changes on an explicit reload
 * — there is no live re-sort while an analyst is scrolled into the
 * list, which satisfies that acceptance criterion by construction.
 * Bulk clear and the row-selection checkbox column from the mockup
 * are not implemented in this pass — no Phase 1 API contract for it
 * (see TASKS.md). */
export function AlertQueueScreen() {
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<AlertQueueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const status = (searchParams.get('status') as CaseStatus | null) ?? undefined;
  const riskTier = (searchParams.get('risk_tier') as RiskTier | null) ?? undefined;
  const page = Number(searchParams.get('page') ?? '1');
  const pageSize = Number(searchParams.get('page_size') ?? String(DEFAULT_PAGE_SIZE));

  const load = useCallback(() => {
    setRows(null);
    listAlerts({ status, riskTier, page, pageSize })
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [status, riskTier, page, pageSize]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch(() => undefined);
  }, []);

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // Reset to page 1 when a filter or page size changes — but not
    // when the caller IS setting "page" itself (Prev/Next), which
    // this unconditionally undid: it set the new page, then deleted
    // it right back out on the same call, so paging always snapped
    // back to page 1.
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const handleClaim = async (caseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setClaiming(caseId);
    try {
      await claimAlert(caseId);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setClaiming(null);
    }
  };

  if (error) return <div className="aml-status aml-status--error">Could not load alert queue: {error}</div>;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const openTotal = summary ? Object.values(summary.openAlertsByTier).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="alert-queue">
      {summary && (
        <div className="stripbar">
          <div className="stripbar__cell" style={{ minWidth: 170 }}>
            <div className="aml-label">Open alerts</div>
            <div className="stripbar__big">{openTotal}</div>
          </div>
          <div className="stripbar__cell" style={{ display: 'flex', gap: 20 }}>
            {RISK_TIERS.map((t) => (
              <div key={t}>
                <div className="aml-label" style={{ color: TIER_COLOR[t] }}>
                  {t}
                </div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{summary.openAlertsByTier[t]}</div>
              </div>
            ))}
          </div>
          <div className="stripbar__cell" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="aml-label" style={{ color: summary.agingAlertsCount > 0 ? 'var(--color-alert)' : undefined }}>
              Past SLA
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18, color: summary.agingAlertsCount > 0 ? 'var(--color-alert)' : undefined }}>
              {summary.agingAlertsCount}
            </div>
          </div>
        </div>
      )}

      <div className="filterbar">
        <span className="aml-label" style={{ marginRight: 2 }}>
          Filter
        </span>
        <select value={status ?? ''} onChange={(e) => updateParam('status', e.target.value || undefined)}>
          <option value="">Status: all</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <select value={riskTier ?? ''} onChange={(e) => updateParam('risk_tier', e.target.value || undefined)}>
          <option value="">Risk tier: all</option>
          {RISK_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="alert-queue__sortstrip">
        <span className="aml-label" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--color-neutral-700)' }}>
          {rows ? `Showing ${rows.length} of ${total}` : '…'} · sorted by risk score, descending · order changes only when you re-filter
        </span>
      </div>

      {rows === null ? (
        <div className="aml-status">Loading alert queue…</div>
      ) : rows.length === 0 ? (
        <div className="tile" style={{ margin: 18, padding: 24, textAlign: 'center' }}>
          No alerts match these filters.
        </div>
      ) : (
        <div className="alert-queue__scroll">
          <div className="qrow qrow--head">
            <div className="qcell">Risk</div>
            <div className="qcell">Matched typology</div>
            <div className="qcell">Customer / account</div>
            <div className="qcell" style={{ color: 'var(--color-accent-800)' }}>
              Agent recommendation
            </div>
            <div className="qcell">SLA remaining</div>
            <div className="qcell">Assigned</div>
            <div className="qcell" style={{ textAlign: 'right' }}>
              Alert
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.caseId} className={`qrow${r.pastSla ? ' qrow--pastSla' : ''}`} onClick={() => navigate(`${base}/cases/${r.caseId}`)}>
              <div className="qcell">
                {r.riskScore !== null ? (
                  <span className={`aml-badge ${r.riskScore >= 80 ? 'aml-badge--critical' : r.riskScore >= 50 ? 'aml-badge--high' : ''}`}>
                    {r.riskScore}
                  </span>
                ) : (
                  <span className="alert-queue__pending">processing…</span>
                )}
              </div>
              <div className="qcell">{r.typologyLabel ? <span className="aml-tag">{r.typologyLabel}</span> : '—'}</div>
              <div className="qcell">
                <div className="alert-queue__customer">{r.customerName ?? r.customerId}</div>
                <div className="alert-queue__account">
                  A/C {r.accountIds.join(', ')}
                  {r.customerName && ` · ${r.customerId}`}
                </div>
              </div>
              <div className="qcell">
                {r.recommendation ? (
                  <>
                    <span className="alert-queue__rec">
                      <span className="dot" style={{ background: 'var(--color-accent-800)', marginRight: 5 }} />
                      {r.recommendation.replace('_', ' ')}
                    </span>
                    {r.recommendationConfidence !== null && <div className="alert-queue__conf">conf. {r.recommendationConfidence.toFixed(2)}</div>}
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div className="qcell">
                {r.slaRemainingHours !== null ? (
                  <>
                    <div className={r.pastSla ? 'alert-queue__sla alert-queue__sla--past' : 'alert-queue__sla'}>
                      {r.pastSla ? `past due ${Math.abs(r.slaRemainingHours).toFixed(1)}h` : `${r.slaRemainingHours.toFixed(1)}h`}
                    </div>
                    {r.slaTargetHours !== null && (
                      <div className="alert-queue__slaBar">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, (r.slaRemainingHours / r.slaTargetHours) * 100))}%`,
                            background: r.pastSla ? 'var(--color-alert)' : 'var(--color-accent-700)',
                          }}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  '—'
                )}
              </div>
              <div className="qcell">
                {r.assignedAnalystName ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span className="alert-queue__avatar">
                      {r.assignedAnalystName
                        .split(/\s+/)
                        .map((w) => w[0])
                        .join('')
                        .slice(0, 2)
                        .toUpperCase()}
                    </span>
                    {r.assignedAnalystName}
                  </span>
                ) : (
                  <button className="aml-btn" disabled={claiming === r.caseId} onClick={(e) => void handleClaim(r.caseId, e)}>
                    {claiming === r.caseId ? 'Claiming…' : 'Claim'}
                  </button>
                )}
              </div>
              <div className="qcell" style={{ textAlign: 'right' }}>
                <div className="alert-queue__id">{r.sourceAlertId}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-accent-700)' }}>open case →</div>
              </div>
            </div>
          ))}
          <div className="alert-queue__pagination">
            <span>
              Rows {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}
            </span>
            <label className="alert-queue__pageSize">
              Show
              <select value={pageSize} onChange={(e) => updateParam('page_size', e.target.value)}>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              per page
            </label>
            <div className="alert-queue__pageNav">
              <button className="aml-btn" disabled={page <= 1} onClick={() => updateParam('page', String(page - 1))}>
                ← Prev
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button className="aml-btn" disabled={page >= totalPages} onClick={() => updateParam('page', String(page + 1))}>
                Next →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
