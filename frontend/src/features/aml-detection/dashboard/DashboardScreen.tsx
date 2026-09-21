import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardSummary } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './dashboard.css';

const TIER_ORDER: Array<{ key: keyof DashboardSummary['openAlertsByTier']; label: string }> = [
  { key: 'critical', label: 'Critical' },
  { key: 'high', label: 'High' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
];

/** specs/suites/bfsi/features/aml-detection/screens/01-dashboard.md
 * Phase 1's "basic Dashboard" — the four top-line figures from
 * api-contracts-phase1.md's reports/summary-basic contract, plus the
 * branch heat-map (BranchRiskSnapshot). The full trend-chart /
 * false-positive-trend version described in the screen spec reuses
 * the Reporting & MI endpoint, which is Phase 2 scope. */
export function DashboardScreen() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const base = useFeatureBasePath();

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) return <div className="aml-status aml-status--error">Could not load dashboard: {error}</div>;
  if (!summary) {
    return (
      <div className="dashboard__tiles">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="aml-card dashboard__tile dashboard__tile--skeleton" />
        ))}
      </div>
    );
  }

  const totalOpen = TIER_ORDER.reduce((sum, t) => sum + summary.openAlertsByTier[t.key], 0);
  const hasAnyCases = totalOpen > 0 || summary.strCtrVolumeThisPeriod.str > 0 || summary.strCtrVolumeThisPeriod.ctr > 0;

  if (!hasAnyCases) {
    return (
      <div className="aml-card dashboard__empty">
        <p>No cases yet for this tenant.</p>
        <p className="dashboard__emptyHint">
          Inject the demo scenarios (agent-service/scripts/inject_demo_alert.py) to see the queue populate.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="dashboard__tiles">
        <div
          className="aml-card dashboard__tile"
          onClick={() => navigate(`${base}/alerts`)}
          role="button"
          tabIndex={0}
        >
          <div className="aml-label">Open alerts by tier</div>
          <div className="dashboard__tierRow">
            {TIER_ORDER.map((t) => (
              <div key={t.key} className={`dashboard__tierStat dashboard__tierStat--${t.key}`}>
                <div className="dashboard__tierValue">{summary.openAlertsByTier[t.key]}</div>
                <div className="dashboard__tierLabel">{t.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="aml-card dashboard__tile">
          <div className="aml-label">STR / CTR volume this period</div>
          <div className="dashboard__bigNumberRow">
            <div>
              <div className="dashboard__bigNumber">{summary.strCtrVolumeThisPeriod.str}</div>
              <div className="dashboard__bigNumberLabel">STR filed</div>
            </div>
            <div>
              <div className="dashboard__bigNumber">{summary.strCtrVolumeThisPeriod.ctr}</div>
              <div className="dashboard__bigNumberLabel">CTR filed</div>
            </div>
          </div>
        </div>

        <div
          className={`aml-card dashboard__tile ${summary.agingAlertsCount > 0 ? 'dashboard__tile--aging' : ''}`}
          onClick={() => navigate(`${base}/alerts`)}
          role="button"
          tabIndex={0}
        >
          <div className="aml-label">Aging alerts (past SLA)</div>
          <div className="dashboard__bigNumber">{summary.agingAlertsCount}</div>
        </div>

        <div className="aml-card dashboard__tile">
          <div className="aml-label">Agent / human override rate</div>
          <div className="dashboard__bigNumber">{Math.round(summary.agentVsHumanOverrideRate * 100)}%</div>
          <div className="dashboard__bigNumberLabel">of dispositions overrode the agent's recommendation</div>
        </div>
      </div>

      {summary.branchRiskHeatmap.length > 0 && (
        <div className="aml-card dashboard__heatmap">
          <div className="aml-label" style={{ marginBottom: 8 }}>
            Branch risk heat-map (open cases)
          </div>
          <table className="dashboard__heatmapTable">
            <thead>
              <tr>
                <th>Branch</th>
                {TIER_ORDER.map((t) => (
                  <th key={t.key}>{t.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from(new Set(summary.branchRiskHeatmap.map((r) => r.branchCode))).map((branch) => (
                <tr key={branch}>
                  <td>{branch}</td>
                  {TIER_ORDER.map((t) => {
                    const cell = summary.branchRiskHeatmap.find((r) => r.branchCode === branch && r.riskTier === t.key);
                    return <td key={t.key}>{cell?.openCaseCount ?? 0}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
