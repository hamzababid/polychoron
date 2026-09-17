import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { claimAlert, listAlerts } from '../api/client';
import type { AlertQueueRow, CaseStatus, RiskTier } from '../api/types';
import './alert-queue.css';

const PAGE_SIZE = 20;

const RISK_TIERS: RiskTier[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: CaseStatus[] = ['open', 'claimed', 'investigating', 'escalated', 'pending_filing', 'cleared', 'filed'];

/** specs/suites/bfsi/features/aml-detection/screens/02-alert-queue.md
 * Filters drive server-side query params (never client-filter a
 * fully-loaded list); sort order is fixed (risk score desc, then
 * created_at desc) and only changes on an explicit reload — there is
 * no live re-sort while an analyst is scrolled into the list, which
 * satisfies that acceptance criterion by construction. Bulk clear
 * (the design export's confirmation-modal flow) is not implemented in
 * this pass — it needs its own backend endpoint, which isn't in
 * api-contracts-phase1.md's Phase 1 surface. */
export function AlertQueueScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<AlertQueueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const status = (searchParams.get('status') as CaseStatus | null) ?? undefined;
  const riskTier = (searchParams.get('risk_tier') as RiskTier | null) ?? undefined;
  const page = Number(searchParams.get('page') ?? '1');

  const load = useCallback(() => {
    setRows(null);
    listAlerts({ status, riskTier, page, pageSize: PAGE_SIZE })
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [status, riskTier, page]);

  useEffect(() => {
    load();
  }, [load]);

  const updateParam = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
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

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="alert-queue__filters">
        <label className="alert-queue__filter">
          <span className="aml-label">Status</span>
          <select value={status ?? ''} onChange={(e) => updateParam('status', e.target.value || undefined)}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="alert-queue__filter">
          <span className="aml-label">Risk tier</span>
          <select value={riskTier ?? ''} onChange={(e) => updateParam('risk_tier', e.target.value || undefined)}>
            <option value="">All</option>
            {RISK_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>

      {rows === null ? (
        <div className="aml-status">Loading alert queue…</div>
      ) : rows.length === 0 ? (
        <div className="aml-card aml-status">No alerts match these filters.</div>
      ) : (
        <>
          <div className="alert-queue__summary">
            Showing {rows.length} of {total} · sorted by risk score, descending · order changes only when you re-filter
          </div>
          <table className="alert-queue__table">
            <thead>
              <tr>
                <th>Risk</th>
                <th>Typology</th>
                <th>Customer / account</th>
                <th>Agent recommendation</th>
                <th>SLA remaining</th>
                <th>Assigned</th>
                <th>Alert</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.caseId}
                  className={r.pastSla ? 'alert-queue__row alert-queue__row--pastSla' : 'alert-queue__row'}
                  onClick={() => navigate(`cases/${r.caseId}`)}
                >
                  <td>
                    {r.riskScore !== null ? (
                      <span className={`aml-badge ${r.riskScore >= 80 ? 'aml-badge--critical' : r.riskScore >= 50 ? 'aml-badge--high' : ''}`}>
                        {r.riskScore}
                      </span>
                    ) : (
                      <span className="alert-queue__pending">processing…</span>
                    )}
                  </td>
                  <td>{r.typologyLabel ? <span className="aml-tag">{r.typologyLabel}</span> : '—'}</td>
                  <td>
                    <div className="alert-queue__customer">{r.customerId}</div>
                    <div className="alert-queue__account">A/C {r.accountIds.join(', ')}</div>
                  </td>
                  <td>
                    {/* Agent recommendation is a label only — never a
                        pre-selected/pre-checked control, per this
                        screen's acceptance criteria. */}
                    {r.recommendation ? (
                      <>
                        <span className="alert-queue__rec">{r.recommendation.replace('_', ' ')}</span>
                        {r.recommendationConfidence !== null && (
                          <div className="alert-queue__conf">conf. {r.recommendationConfidence.toFixed(2)}</div>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {r.slaRemainingHours !== null ? (
                      <span className={r.pastSla ? 'alert-queue__sla alert-queue__sla--past' : 'alert-queue__sla'}>
                        {r.pastSla ? `past due ${Math.abs(r.slaRemainingHours).toFixed(1)}h` : `${r.slaRemainingHours.toFixed(1)}h`}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    {r.assignedAnalystName ? (
                      r.assignedAnalystName
                    ) : (
                      <button className="aml-btn" disabled={claiming === r.caseId} onClick={(e) => void handleClaim(r.caseId, e)}>
                        {claiming === r.caseId ? 'Claiming…' : 'Claim'}
                      </button>
                    )}
                  </td>
                  <td className="alert-queue__id">{r.sourceAlertId}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="alert-queue__pagination">
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
        </>
      )}
    </div>
  );
}
