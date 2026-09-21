import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardSummary } from '../api/client';
import type { DashboardSummary } from '../api/types';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './dashboard.css';

const TIER_ORDER: Array<{ key: keyof DashboardSummary['openAlertsByTier']; label: string; color: string }> = [
  { key: 'critical', label: 'Critical', color: 'var(--color-alert)' },
  { key: 'high', label: 'High', color: 'var(--color-accent-700)' },
  { key: 'medium', label: 'Medium', color: 'var(--color-accent-400)' },
  { key: 'low', label: 'Low', color: 'var(--color-neutral-400)' },
];

/** specs/suites/bfsi/features/aml-detection/screens/01-dashboard.md
 * Phase 1's "basic Dashboard" — the four top-line figures from
 * api-contracts-phase1.md's reports/summary-basic contract, plus the
 * branch heat-map (BranchRiskSnapshot), restyled to match
 * design-exports/bfsi/aml-detection/Command Dashboard.dc.html's tile
 * language. That mockup also shows a 6-month trend chart, an
 * IRAR-by-risk-type heat-map and an agent-vs-officer disposition
 * breakdown — none of which Phase 1's actual API computes, so rather
 * than fabricate numbers for those, this screen only renders what
 * reports/summary-basic actually returns. The full trend/time-series
 * version is Phase 2 (Reporting & MI) scope. */
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

  return (
    <div className="dashboard">
      <div className="dashboard__strip">
        <div>
          <h4 style={{ margin: 0 }}>AML programme — command view</h4>
          <div className="aml-label" style={{ textTransform: 'none', letterSpacing: 0, marginTop: 2 }}>
            Figures refresh on load only, so a number does not move while you are reading it.
          </div>
        </div>
      </div>

      {!summary ? (
        <div className="dashboard__tiles">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="tile dashboard__tile--skeleton" />
          ))}
        </div>
      ) : (
        <DashboardBody summary={summary} navigate={navigate} base={base} />
      )}
    </div>
  );
}

function DashboardBody({
  summary,
  navigate,
  base,
}: {
  summary: DashboardSummary;
  navigate: ReturnType<typeof useNavigate>;
  base: string;
}) {
  const totalOpen = TIER_ORDER.reduce((sum, t) => sum + summary.openAlertsByTier[t.key], 0);
  const hasAnyCases = totalOpen > 0 || summary.strCtrVolumeThisPeriod.str > 0 || summary.strCtrVolumeThisPeriod.ctr > 0;

  if (!hasAnyCases) {
    return (
      <div className="tile dashboard__empty">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <p style={{ margin: 0 }}>No cases yet for this tenant.</p>
        <p className="dashboard__emptyHint">
          Inject the demo scenarios (agent-service/scripts/inject_demo_alert.py) to see the queue populate.
        </p>
      </div>
    );
  }

  const aging = summary.agingAlertsCount > 0;

  return (
    <div className="dashboard__scroll">
      <div className="dashboard__tiles">
        <a
          className="tile"
          onClick={(e) => {
            e.preventDefault();
            navigate(`${base}/alerts`);
          }}
          href={`${base}/alerts`}
        >
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Open alerts</span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--color-accent-700)' }}>open queue →</span>
          </div>
          <div className="tile-body">
            <div className="dashboard__bigNumber">{totalOpen}</div>
            <div className="dashboard__tierBar">
              {TIER_ORDER.map((t) => {
                const count = summary.openAlertsByTier[t.key];
                const pct = totalOpen > 0 ? (count / totalOpen) * 100 : 0;
                return <span key={t.key} style={{ width: `${pct}%`, background: t.color }} />;
              })}
            </div>
            <div className="dashboard__tierLegend">
              {TIER_ORDER.map((t) => (
                <span key={t.key}>
                  <span className="dot" style={{ background: t.color }} />
                  {t.label} {summary.openAlertsByTier[t.key]}
                </span>
              ))}
            </div>
          </div>
        </a>

        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">STR / CTR volume this period</span>
          </div>
          <div className="tile-body">
            <div style={{ display: 'flex', gap: 24 }}>
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
        </div>

        <a
          className="tile"
          style={aging ? { borderColor: 'var(--color-alert)', borderWidth: 2, background: 'color-mix(in srgb, var(--color-alert) 6%, transparent)' } : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(`${base}/alerts`);
          }}
          href={`${base}/alerts`}
        >
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label" style={aging ? { color: 'var(--color-alert)' } : undefined}>
              Aging alerts (past SLA)
            </span>
            <span style={{ marginLeft: 'auto', fontSize: 10.5, color: aging ? 'var(--color-alert)' : 'var(--color-accent-700)' }}>
              open queue →
            </span>
          </div>
          <div className="tile-body">
            <div className="dashboard__bigNumber" style={aging ? { color: 'var(--color-alert)' } : undefined}>
              {summary.agingAlertsCount}
            </div>
          </div>
        </a>

        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Agent / human override rate</span>
          </div>
          <div className="tile-body">
            <div className="dashboard__bigNumber">{Math.round(summary.agentVsHumanOverrideRate * 100)}%</div>
            <div className="dashboard__bigNumberLabel">of dispositions overrode the agent's recommendation</div>
          </div>
        </div>
      </div>

      {summary.branchRiskHeatmap.length > 0 && (
        <div className="tile dashboard__heatmap">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Branch risk heat-map — open cases</span>
          </div>
          <div className="tile-body">
            <table className="table dashboard__heatmapTable">
              <thead>
                <tr>
                  <th>Branch</th>
                  {TIER_ORDER.map((t) => (
                    <th key={t.key} style={{ textAlign: 'center' }}>
                      {t.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from(new Set(summary.branchRiskHeatmap.map((r) => r.branchCode))).map((branch) => (
                  <tr key={branch}>
                    <td>{branch}</td>
                    {TIER_ORDER.map((t) => {
                      const cell = summary.branchRiskHeatmap.find((r) => r.branchCode === branch && r.riskTier === t.key);
                      const count = cell?.openCaseCount ?? 0;
                      return (
                        <td key={t.key} style={{ textAlign: 'center' }}>
                          {count > 0 ? (
                            <span
                              className="dashboard__heatCell"
                              style={{ background: `color-mix(in srgb, ${t.color} ${Math.min(count * 20 + 15, 85)}%, transparent)` }}
                            >
                              {count}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--color-neutral-400)' }}>0</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
