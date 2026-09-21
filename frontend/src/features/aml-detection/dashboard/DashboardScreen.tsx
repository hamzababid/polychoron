import { Fragment, useEffect, useState } from 'react';
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

const HEAT_STEPS = [
  { max: 0, bg: 'transparent', fg: 'var(--color-neutral-400)' },
  { max: 0.15, bg: 'var(--color-accent-100)', fg: 'var(--color-text)' },
  { max: 0.35, bg: 'var(--color-accent-300)', fg: 'var(--color-text)' },
  { max: 0.6, bg: 'var(--color-accent-500)', fg: 'var(--color-bg)' },
  { max: 0.8, bg: 'var(--color-accent-700)', fg: 'var(--color-bg)' },
  { max: Infinity, bg: 'var(--color-accent-900)', fg: 'var(--color-bg)' },
];

function heatStyle(count: number, maxCount: number): { bg: string; fg: string } {
  if (count === 0) return HEAT_STEPS[0];
  const ratio = count / maxCount;
  return HEAT_STEPS.find((s) => ratio <= s.max) ?? HEAT_STEPS[HEAT_STEPS.length - 1];
}

/** A single-hue intensity ramp (one accent, five steps) rather than
 * one hue per risk tier — the tier is already labeled by the column
 * header, so coloring each cell by its own tier color turned the
 * table into an unreadable four-color mosaic instead of a heat-map.
 * Matches design-exports/.../Command Dashboard.dc.html's IRAR
 * grid treatment (low→high on one ramp, cell fills the full block,
 * text flips light on the two darkest steps). */
function BranchRiskHeatmap({ heatmap }: { heatmap: DashboardSummary['branchRiskHeatmap'] }) {
  const branches = Array.from(new Set(heatmap.map((r) => r.branchCode))).sort();
  const maxCount = Math.max(1, ...heatmap.map((r) => r.openCaseCount));

  return (
    <div className="tile dashboard__heatmap">
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className="tile-head">
        <span className="aml-label">Branch risk heat-map — open cases</span>
        <span className="dashboard__heatLegend">
          low
          <span className="dashboard__heatLegendRamp">
            {HEAT_STEPS.slice(1).map((s, i) => (
              <span key={i} style={{ background: s.bg }} />
            ))}
          </span>
          high
        </span>
      </div>
      <div className="tile-body">
        <div className="dashboard__heatGrid" style={{ gridTemplateColumns: `160px repeat(${TIER_ORDER.length}, 1fr)` }}>
          <div />
          {TIER_ORDER.map((t) => (
            <div key={t.key} className="dashboard__heatColHead">
              {t.label}
            </div>
          ))}
          {branches.map((branch) => (
            <Fragment key={branch}>
              <div className="dashboard__heatBranch">{branch}</div>
              {TIER_ORDER.map((t) => {
                const cell = heatmap.find((r) => r.branchCode === branch && r.riskTier === t.key);
                const count = cell?.openCaseCount ?? 0;
                const style = heatStyle(count, maxCount);
                return (
                  <div key={t.key} className="dashboard__heatCell" style={{ background: style.bg, color: style.fg }}>
                    {count > 0 ? count : ''}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
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

      {summary.branchRiskHeatmap.length > 0 && <BranchRiskHeatmap heatmap={summary.branchRiskHeatmap} />}
    </div>
  );
}
