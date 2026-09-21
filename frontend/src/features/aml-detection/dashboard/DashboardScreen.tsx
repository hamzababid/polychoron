import { Fragment, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDashboardSummary, getDashboardTrends } from '../api/client';
import type { DashboardSummary, DashboardTrends, MonthlyTrendPoint } from '../api/types';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './dashboard.css';

const TIER_ORDER: Array<{ key: keyof DashboardSummary['openAlertsByTier']; label: string; color: string }> = [
  { key: 'critical', label: 'Critical', color: 'var(--color-alert)' },
  { key: 'high', label: 'High', color: 'var(--color-accent-700)' },
  { key: 'medium', label: 'Medium', color: 'var(--color-accent-400)' },
  { key: 'low', label: 'Low', color: 'var(--color-neutral-400)' },
];

/** specs/suites/bfsi/features/aml-detection/screens/01-dashboard.md
 * Phase 1's stat tiles (reports/summary-basic) plus, per TASKS.md's
 * "ADDITIVE — Dashboard Trend Widgets", four widgets pulled forward
 * from Phase 2 Reporting & MI (reports/summary-trends) — all real
 * computations over existing data, no fabricated numbers. The
 * mockup's IRAR risk-by-type heat-map stays deferred: it's a
 * periodic human-assessed artifact, not a query. */
export function DashboardScreen() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const base = useFeatureBasePath();

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    getDashboardTrends()
      .then(setTrends)
      .catch(() => undefined);
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
        <DashboardBody summary={summary} trends={trends} navigate={navigate} base={base} />
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

const HEAT_PAGE_SIZE_OPTIONS = [10, 25, 50];
const DEFAULT_HEAT_PAGE_SIZE = 10;

/** A single-hue intensity ramp (one accent, five steps) rather than
 * one hue per risk tier — the tier is already labeled by the column
 * header, so coloring each cell by its own tier color turned the
 * table into an unreadable four-color mosaic instead of a heat-map.
 * Matches design-exports/.../Command Dashboard.dc.html's IRAR
 * grid treatment (low→high on one ramp, cell fills the full block,
 * text flips light on the two darkest steps).
 *
 * Paginated client-side — the whole heat-map already arrives in one
 * reports/summary-basic response (it's not its own paginated
 * endpoint), so there's nothing to fetch per page, only a slice of
 * what's already in memory. */
function BranchRiskHeatmap({ heatmap }: { heatmap: DashboardSummary['branchRiskHeatmap'] }) {
  const allBranches = Array.from(new Set(heatmap.map((r) => r.branchCode))).sort();
  const maxCount = Math.max(1, ...heatmap.map((r) => r.openCaseCount));

  const [pageSize, setPageSize] = useState(DEFAULT_HEAT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(allBranches.length / pageSize));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const start = (page - 1) * pageSize;
  const branches = allBranches.slice(start, start + pageSize);

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
          <div className="dashboard__heatColHead" style={{ textAlign: 'left' }}>
            Branch
          </div>
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

        <div className="dashboard__heatPagination">
          <span>
            Showing {allBranches.length === 0 ? 0 : start + 1}–{Math.min(start + pageSize, allBranches.length)} of {allBranches.length} branches
          </span>
          <label className="dashboard__heatPageSize">
            Show
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
            >
              {HEAT_PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            per page
          </label>
          <div className="dashboard__heatPageNav">
            <button className="aml-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ← Prev
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button className="aml-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function monthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

/** Hand-coded SVG, no charting library — matches how the Claude Design
 * mockup itself builds its charts. `barValue`/`lineValue` are both
 * optional so the same component covers the volume+conversion combo
 * chart (bars + line) and the false-positive-only line chart. */
function TrendChart({
  points,
  barValue,
  lineValue,
  lineFormat,
}: {
  points: MonthlyTrendPoint[];
  barValue?: (p: MonthlyTrendPoint) => number;
  lineValue?: (p: MonthlyTrendPoint) => number;
  lineFormat?: (v: number) => string;
}) {
  const W = 560;
  const H = 150;
  const padL = 6;
  const padR = 6;
  const padT = 20;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slotW = plotW / points.length;
  const barGap = 8;
  const barWidth = Math.max(4, slotW - barGap);
  const maxBar = Math.max(1, ...(barValue ? points.map(barValue) : [0]));
  const formatLine = lineFormat ?? ((v: number) => `${Math.round(v * 100)}%`);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', fontFamily: 'var(--font-body)' }}>
      <g stroke="var(--color-divider)">
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} />
        <line x1={padL} y1={padT + plotH * 0.5} x2={W - padR} y2={padT + plotH * 0.5} strokeDasharray="3 4" />
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} strokeDasharray="3 4" />
      </g>

      {barValue &&
        points.map((p, i) => {
          const v = barValue(p);
          const x = padL + i * slotW + (slotW - barWidth) / 2;
          const h = (v / maxBar) * plotH;
          const y = padT + plotH - h;
          const isLast = i === points.length - 1;
          return (
            <g key={p.month}>
              <rect x={x} y={y} width={barWidth} height={Math.max(h, 0)} fill={isLast ? 'var(--color-accent-900)' : 'var(--color-accent-500)'} />
              {v > 0 && (
                <text x={x + barWidth / 2} y={y - 4} fontSize="9.5" textAnchor="middle" fill="var(--color-neutral-700)">
                  {v}
                </text>
              )}
            </g>
          );
        })}

      {lineValue && (
        <>
          <polyline
            points={points
              .map((p, i) => {
                const x = padL + i * slotW + slotW / 2;
                const y = padT + plotH * (1 - Math.max(0, Math.min(1, lineValue(p))));
                return `${x},${y}`;
              })
              .join(' ')}
            fill="none"
            stroke="var(--color-accent-800)"
            strokeWidth="2"
          />
          {points.map((p, i) => {
            const v = lineValue(p);
            const x = padL + i * slotW + slotW / 2;
            const y = padT + plotH * (1 - Math.max(0, Math.min(1, v)));
            return (
              <g key={`pt-${p.month}`}>
                <rect x={x - 3} y={y - 3} width={6} height={6} fill="var(--color-bg)" stroke="var(--color-accent-800)" strokeWidth="1.5" />
                <text x={x} y={y - 7} fontSize="9" textAnchor="middle" fill="var(--color-accent-800)">
                  {formatLine(v)}
                </text>
              </g>
            );
          })}
        </>
      )}

      <g fontSize="10" fill="var(--color-neutral-700)" textAnchor="middle">
        {points.map((p, i) => (
          <text key={p.month} x={padL + i * slotW + slotW / 2} y={H - 4}>
            {monthShortLabel(p.month)}
          </text>
        ))}
      </g>
    </svg>
  );
}

function DashboardBody({
  summary,
  trends,
  navigate,
  base,
}: {
  summary: DashboardSummary;
  trends: DashboardTrends | null;
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

      {trends && (
        <>
          <div className="dashboard__row">
            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="tile-head">
                <span className="aml-label">Alert volume &amp; STR conversion</span>
                <span className="dashboard__tileHint">last 6 months · bars = alerts raised, line = share filed as STR</span>
              </div>
              <div className="tile-body">
                <TrendChart points={trends.monthlyTrend} barValue={(p) => p.alertsRaised} lineValue={(p) => p.strConversionRate} />
              </div>
            </div>

            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="tile-head">
                <span className="aml-label">Agent vs. officer disposition</span>
                <span className="dashboard__tileHint">last 6 months · {trends.dispositionBreakdown.totalDispositioned} dispositioned</span>
              </div>
              <div className="tile-body">
                {trends.dispositionBreakdown.totalDispositioned === 0 ? (
                  <div className="dashboard__muted">No dispositions recorded in this window yet.</div>
                ) : (
                  <DispositionBreakdownBars breakdown={trends.dispositionBreakdown} />
                )}
              </div>
            </div>
          </div>

          <div className="dashboard__row">
            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="tile-head">
                <span className="aml-label">False-positive rate</span>
                <span className="dashboard__tileHint">agent-flagged suspicion, cleared with no suspicion · share of alerts raised</span>
              </div>
              <div className="tile-body">
                <TrendChart points={trends.monthlyTrend} lineValue={(p) => p.falsePositiveRate} />
              </div>
            </div>

            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="tile-head">
                <span className="aml-label">Most aging alerts</span>
                <span style={{ marginLeft: 'auto', fontSize: 10.5, color: 'var(--color-accent-700)' }}>open queue →</span>
              </div>
              <div>
                {trends.mostAgingAlerts.length === 0 ? (
                  <div className="dashboard__muted" style={{ padding: '11px 13px 13px' }}>
                    No open alerts.
                  </div>
                ) : (
                  trends.mostAgingAlerts.map((a) => (
                    <div key={a.caseId} className="dashboard__agingRow" onClick={() => navigate(`${base}/cases/${a.caseId}`)}>
                      {a.riskScore !== null && (
                        <span className={`aml-badge ${a.riskScore >= 80 ? 'aml-badge--critical' : a.riskScore >= 50 ? 'aml-badge--high' : ''}`}>{a.riskScore}</span>
                      )}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13 }}>{a.customerName ?? a.sourceAlertId}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
                          {a.sourceAlertId}
                          {a.typologyLabel ? ` · ${a.typologyLabel}` : ''} · {a.assignedAnalystName ?? 'unassigned'}
                        </div>
                      </div>
                      {a.slaRemainingHours !== null && (
                        <div style={{ flex: 'none', textAlign: 'right' }}>
                          <div style={{ fontSize: 12, color: a.slaRemainingHours < 0 ? 'var(--color-alert)' : 'var(--color-accent-700)' }}>
                            {a.slaRemainingHours < 0 ? `past due ${Math.abs(a.slaRemainingHours).toFixed(1)}h` : `${a.slaRemainingHours.toFixed(1)}h left`}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {summary.branchRiskHeatmap.length > 0 && <BranchRiskHeatmap heatmap={summary.branchRiskHeatmap} />}
    </div>
  );
}

function DispositionBreakdownBars({ breakdown }: { breakdown: DashboardTrends['dispositionBreakdown'] }) {
  const { totalDispositioned, agreedWithAgent, overrodeAgent } = breakdown;
  const agreedPct = (agreedWithAgent / totalDispositioned) * 100;
  const overridePct = (overrodeAgent / totalDispositioned) * 100;

  return (
    <>
      <div style={{ display: 'flex', height: 16, gap: 1 }}>
        <span style={{ width: `${agreedPct}%`, background: 'var(--color-accent-500)' }} />
        <span style={{ width: `${overridePct}%`, background: 'var(--color-accent-900)' }} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span className="dot" style={{ background: 'var(--color-accent-500)', marginTop: 4 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              <strong>{Math.round(agreedPct)}%</strong> agreed with the agent's recommendation
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{agreedWithAgent} dispositions</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <span className="dot" style={{ background: 'var(--color-accent-900)', marginTop: 4 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              <strong>{Math.round(overridePct)}%</strong> overrode the agent's recommendation
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{overrodeAgent} dispositions, each with a logged reason</div>
          </div>
        </div>
      </div>
    </>
  );
}
