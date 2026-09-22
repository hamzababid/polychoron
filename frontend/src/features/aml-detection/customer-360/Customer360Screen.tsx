import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCustomer360 } from '../api/client';
import type { Customer360Response } from '../api/types';
import { LinkedEntityGraph } from '../shared/LinkedEntityGraph';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './customer-360.css';

/** specs/suites/bfsi/features/aml-detection/screens/08-customer-360.md
 * Read-only aggregation screen — no disposition/filing actions live
 * here (those stay on Case Workspace / Filing Console). Reachable from
 * Alert Queue and Case Workspace as a real bookmarkable route, not a
 * modal. (Screening Hub is Phase 2 scope not yet built — that third
 * entry point will link here once it exists.) */
export function Customer360Screen() {
  const { customerId = '' } = useParams();
  const base = useFeatureBasePath();
  const [data, setData] = useState<Customer360Response | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    getCustomer360(customerId)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [customerId]);

  if (error) return <div className="aml-status aml-status--error">Could not load customer: {error}</div>;
  if (!data) return <div className="aml-status">Loading customer…</div>;

  const displayName = data.kyc?.customer_name ?? customerId;

  return (
    <div className="customer-360">
      <div className="customer-360__identity">
        <div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{displayName}</div>
          <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
            {customerId}
            {data.kyc && ` · CNIC ${data.kyc.cnic}`}
          </div>
        </div>
        <span className="aml-tag" style={{ fontSize: 10 }}>
          READ-ONLY · AGGREGATED ACROSS ALL CASES
        </span>
      </div>

      <div className="customer-360__scroll">
        <div className="customer-360__summaryRow">
          <div className="tile customer-360__summaryTile">
            <div className="aml-label">Current risk score</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>
              {data.currentRiskScore !== null ? `${data.currentRiskScore}/100` : '—'}
            </div>
          </div>
          <div className="tile customer-360__summaryTile">
            <div className="aml-label">Accounts</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{data.accounts.length}</div>
          </div>
          <div className="tile customer-360__summaryTile">
            <div className="aml-label">Prior cases</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{data.priorCases.length}</div>
          </div>
          <div className="tile customer-360__summaryTile">
            <div className="aml-label">Filings</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 22 }}>{data.filingsCount}</div>
          </div>
        </div>

        {data.kyc && (
          <div className="tile">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head">
              <span className="aml-label">KYC snapshot (latest across cases)</span>
            </div>
            <div className="tile-body" style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 13 }}>
              <div>{data.kyc.declared_occupation}</div>
              {data.kyc.declared_monthly_turnover !== null && (
                <div>Declared turnover: {data.kyc.declared_monthly_turnover.toLocaleString()} PKR/mo</div>
              )}
              <div>KYC risk: {data.kyc.kyc_risk_rating}</div>
              <div>{data.kyc.address}</div>
              <div>Account opened {new Date(data.kyc.account_opening_date).toLocaleDateString()}</div>
            </div>
          </div>
        )}

        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Accounts</span>
          </div>
          <div className="tile-body">
            {data.accounts.length === 0 ? (
              <div className="customer-360__muted">No accounts on file.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Referenced by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.accountId}>
                      <td>{a.accountId}</td>
                      <td>
                        {a.caseIds.map((caseId, i) => (
                          <span key={caseId}>
                            {i > 0 && ', '}
                            <Link to={`${base}/cases/${caseId}`}>{caseId.slice(0, 8)}</Link>
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Case history</span>
          </div>
          <div className="tile-body">
            {data.priorCases.length === 0 ? (
              <div className="customer-360__muted">None on file.</div>
            ) : (
              <ul className="customer-360__list">
                {data.priorCases.map((p) => (
                  <li key={p.caseId}>
                    <Link to={`${base}/cases/${p.caseId}`}>{p.typologyLabel ?? 'Case ' + p.caseId.slice(0, 8)}</Link> · opened{' '}
                    {new Date(p.openedAt).toLocaleDateString()}
                    {p.closedAt && ` · closed ${new Date(p.closedAt).toLocaleDateString()}`}
                    {p.finalDisposition && ` · ${p.finalDisposition.replace('_', ' ')}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Linked entities (aggregated)</span>
          </div>
          <div className="tile-body">
            <LinkedEntityGraph centerLabel={displayName} entities={data.linkedEntities} />
          </div>
        </div>

        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Screening history</span>
          </div>
          <div className="tile-body">
            {data.screeningHistory.length === 0 ? (
              <div className="customer-360__muted">No prior sanctions/PEP hits.</div>
            ) : (
              <ul className="customer-360__list">
                {data.screeningHistory.map((s, i) => (
                  <li key={i}>
                    {s.list_source}: {s.matched_name} ({(s.match_confidence * 100).toFixed(0)}%) —{' '}
                    <Link to={`${base}/cases/${s.caseId}`}>case {s.caseId.slice(0, 8)}</Link>
                    {s.disposition && ` · ${s.disposition.replace('_', ' ')}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
