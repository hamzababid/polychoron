import { useCallback, useEffect, useState } from 'react';
import { downloadReport, generateReport, getReportingSummary, listReportHistory } from '../api/client';
import type { ReportHistoryEntry, ReportingBreakdownBy, ReportingSummary } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../shell/ToastProvider';
import './reporting.css';

type PeriodPreset = 'month' | 'quarter' | 'custom';

function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function startOfQuarter(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
}
function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** specs/suites/bfsi/features/aml-detection/screens/10-reporting-mi.md
 * — restyled to match design-exports/bfsi/aml-detection/Reporting
 * MI.dc.html's report-identity + numbered-panel layout.
 *
 * Two things the mockup shows that aren't reproduced here, same
 * honesty discipline as Model Governance and Typology Console:
 * 1. Agent workload is a 2-way agreed/overrode split, not the
 *    mockup's 3-way "agent-recommended signed off / full manual /
 *    overrode" — this system has no distinct low-friction sign-off
 *    path to tell apart from a full investigation (same resolution
 *    TASKS.md's Dashboard Trend Widgets section already made).
 * 2. The mockup's "breach commentary" and "model-risk assessment"
 *    panels are written narrative text (specific case IDs, named
 *    causes) — nothing in this schema generates prose like that, so
 *    they're left out rather than invented.
 * Format is CSV only (see reporting.service.ts / generate-report.dto.ts
 * — no PDF library in app-api yet, no real SBP submission template).
 */
export function ReportingScreen() {
  const { session } = useAuth();
  const toast = useToast();

  const [preset, setPreset] = useState<PeriodPreset>('quarter');
  const [customStart, setCustomStart] = useState(toDateInputValue(startOfMonth(new Date())));
  const [customEnd, setCustomEnd] = useState(toDateInputValue(new Date()));
  const [comparePrevious, setComparePrevious] = useState(true);
  const [breakdownBy, setBreakdownBy] = useState<ReportingBreakdownBy>('type');

  const [summary, setSummary] = useState<ReportingSummary | null>(null);
  const [history, setHistory] = useState<ReportHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reportName, setReportName] = useState('Board MI pack');
  const [generating, setGenerating] = useState(false);

  const periodBounds = useCallback((): { start: Date; end: Date } => {
    const now = new Date();
    if (preset === 'month') return { start: startOfMonth(now), end: now };
    if (preset === 'quarter') return { start: startOfQuarter(now), end: now };
    return { start: new Date(customStart), end: new Date(`${customEnd}T23:59:59Z`) };
  }, [preset, customStart, customEnd]);

  const loadSummary = useCallback(() => {
    const { start, end } = periodBounds();
    getReportingSummary({ periodStart: start.toISOString(), periodEnd: end.toISOString(), comparePrevious, breakdownBy })
      .then(setSummary)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [periodBounds, comparePrevious, breakdownBy]);

  const loadHistory = useCallback(() => {
    listReportHistory().then(setHistory).catch(() => undefined);
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleGenerate = async () => {
    if (!session || !reportName.trim()) return;
    setGenerating(true);
    try {
      const { start, end } = periodBounds();
      const report = await generateReport({
        report_name: reportName,
        period_start: start.toISOString(),
        period_end: end.toISOString(),
        compare_previous: comparePrevious,
        breakdown_by: breakdownBy,
        format: 'csv',
        generated_by: session.user.userId,
      });
      toast.success(`${report.reportId.slice(0, 8)} generated — figures fixed as at ${new Date().toLocaleString()}.`);
      loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async (r: ReportHistoryEntry) => {
    try {
      await downloadReport(r.reportId, r.fileName);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) return <div className="aml-status aml-status--error">Could not load reporting data: {error}</div>;
  if (!summary) return <div className="aml-status">Loading reporting &amp; MI…</div>;

  const delta = (cur: number | null, prev: number | null): string | null => {
    if (!comparePrevious || cur === null || prev === null) return null;
    const d = cur - prev;
    return `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString(undefined, { maximumFractionDigits: 1 })} vs ${prev.toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
  };

  const maxMonthlyVolume = Math.max(1, ...summary.monthlyFilingVolume.flatMap((p) => [p.strCount, p.ctrCount]));
  const maxBreakdown = Math.max(1, ...summary.breakdown.map((b) => b.count));

  return (
    <div className="reporting">
      <div className="reporting__header">
        <div className="reporting__headerCell reporting__headerTitle">
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>Reporting &amp; management information</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>Figures drawn from filed records, matching Dashboard's own computation for the same period</div>
        </div>
        <div className="reporting__headerCell">
          <div className="aml-label">Period</div>
          <div style={{ fontSize: 13 }}>
            {new Date(summary.periodStart).toLocaleDateString()} – {new Date(summary.periodEnd).toLocaleDateString()}
          </div>
          <div className="reporting__asOf">figures as of {new Date(summary.asOf).toLocaleString()}</div>
        </div>
        <div className="reporting__headerCell">
          <div className="aml-label">Comparison</div>
          <div style={{ fontSize: 13 }}>{summary.comparePrevious ? 'Against preceding equal period' : 'No comparison'}</div>
        </div>
        <div className="reporting__headerCell reporting__headerActions">
          <input className="input" style={{ width: 170, fontSize: 12.5 }} placeholder="Report name" value={reportName} onChange={(e) => setReportName(e.target.value)} />
          <button className="aml-btn aml-btn--primary" disabled={generating || !reportName.trim()} onClick={() => void handleGenerate()}>
            {generating ? 'Generating…' : 'Generate report'}
          </button>
        </div>
      </div>

      <div className="reporting__scroll">
        <div className="tile reporting__panel">
          <div className="tile-body reporting__controlsRow">
            <span className="reporting__num">01</span>
            <span className="aml-label">Period</span>
            <div className="reporting__seg">
              <label className={`reporting__segOpt${preset === 'month' ? ' reporting__segOpt--active' : ''}`}>
                <input type="radio" checked={preset === 'month'} onChange={() => setPreset('month')} /> This month
              </label>
              <label className={`reporting__segOpt${preset === 'quarter' ? ' reporting__segOpt--active' : ''}`}>
                <input type="radio" checked={preset === 'quarter'} onChange={() => setPreset('quarter')} /> This quarter
              </label>
              <label className={`reporting__segOpt${preset === 'custom' ? ' reporting__segOpt--active' : ''}`}>
                <input type="radio" checked={preset === 'custom'} onChange={() => setPreset('custom')} /> Custom range
              </label>
            </div>
            {preset === 'custom' && (
              <>
                <input type="date" className="input" value={customStart} onChange={(e) => setCustomStart(e.target.value)} style={{ fontSize: 12.5 }} />
                <span>–</span>
                <input type="date" className="input" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} style={{ fontSize: 12.5 }} />
              </>
            )}
            <span className="reporting__divider" />
            <label className="reporting__compareToggle">
              <input type="checkbox" checked={comparePrevious} onChange={(e) => setComparePrevious(e.target.checked)} />
              Compare to previous period
            </label>
          </div>
        </div>

        <div className="reporting__metricsGrid">
          <MetricTile num="A" label="STR-F filed" value={summary.strFiledCount.toLocaleString()} delta={delta(summary.strFiledCount, summary.strFiledPrevCount)} />
          <MetricTile num="B" label="CTR filed" value={summary.ctrFiledCount.toLocaleString()} delta={delta(summary.ctrFiledCount, summary.ctrFiledPrevCount)} />
          <MetricTile
            num="C"
            label="Avg. time to file"
            value={summary.avgTimeToFileHours !== null ? `${summary.avgTimeToFileHours.toFixed(1)} h` : '—'}
            delta={delta(summary.avgTimeToFileHours, summary.avgTimeToFilePrevHours)}
            sub="Officer disposition to goAML submission."
          />
          <MetricTile
            num="D"
            label="SLA adherence"
            value={summary.slaAdherenceOverall !== null ? `${(summary.slaAdherenceOverall * 100).toFixed(1)}%` : '—'}
            delta={delta(summary.slaAdherenceOverall, summary.slaAdherenceOverallPrev)}
          />
        </div>

        <div className="tile reporting__panel">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head reporting__phead">
            <span className="reporting__num">03</span>
            <h4 style={{ margin: 0 }}>Filing volume</h4>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>STR-F and CTR filings by month</span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {(['type', 'typology', 'branch'] as ReportingBreakdownBy[]).map((b) => (
                <button key={b} className={`aml-btn${breakdownBy === b ? ' aml-btn--primary' : ''}`} style={{ fontSize: 11 }} onClick={() => setBreakdownBy(b)}>
                  {b === 'type' ? 'Report type' : b === 'typology' ? 'Typology' : 'Branch'}
                </button>
              ))}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 1, background: 'var(--color-divider)' }}>
            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              {summary.monthlyFilingVolume.length === 0 ? (
                <div className="reporting__muted">No filings in this period.</div>
              ) : (
                <div className="reporting__volumeChart">
                  {summary.monthlyFilingVolume.map((p) => (
                    <div key={p.month} className="reporting__volumeCol">
                      <div className="reporting__volumeBars">
                        <span className="reporting__volumeBar reporting__volumeBar--ctr" style={{ height: `${(p.ctrCount / maxMonthlyVolume) * 100}%` }} title={`CTR ${p.ctrCount}`} />
                        <span className="reporting__volumeBar reporting__volumeBar--str" style={{ height: `${(p.strCount / maxMonthlyVolume) * 100}%` }} title={`STR-F ${p.strCount}`} />
                      </div>
                      <div className="reporting__volumeLabel">{p.month}</div>
                      <div className="reporting__volumeCounts">
                        CTR {p.ctrCount} · STR {p.strCount}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="reporting__legend">
                <span>
                  <span className="reporting__legendSwatch" style={{ background: 'var(--color-accent-300)' }} /> CTR
                </span>
                <span>
                  <span className="reporting__legendSwatch" style={{ background: 'var(--color-accent-800)' }} /> STR-F
                </span>
              </div>
            </div>
            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              <div className="aml-label" style={{ marginBottom: 8 }}>
                Breakdown by {breakdownBy}
              </div>
              {summary.breakdown.length === 0 ? (
                <div className="reporting__muted">No data for this breakdown.</div>
              ) : (
                summary.breakdown.map((b) => (
                  <div key={b.code} className="reporting__breakdownRow">
                    <div className="reporting__breakdownName">{b.label}</div>
                    <div className="reporting__breakdownCount">{b.count}</div>
                    <span className="reporting__breakdownBarTrack">
                      <span className="reporting__breakdownBarFill" style={{ width: `${(b.count / maxBreakdown) * 100}%` }} />
                    </span>
                    <div className="reporting__breakdownPct">{(b.percentOfTotal * 100).toFixed(1)}%</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="tile reporting__panel">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head reporting__phead">
            <span className="reporting__num">04</span>
            <h4 style={{ margin: 0 }}>SLA adherence by risk tier</h4>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>Alerts dispositioned within their target, from alert raised to officer disposition</span>
          </div>
          <div className="reporting__slaHead">
            <div className="reporting__ahd">Risk tier</div>
            <div className="reporting__ahd" style={{ textAlign: 'right' }}>
              Alerts
            </div>
            <div className="reporting__ahd">Within target / breached</div>
            <div className="reporting__ahd" style={{ textAlign: 'right' }}>
              Adherence
            </div>
            {comparePrevious && (
              <div className="reporting__ahd" style={{ textAlign: 'right' }}>
                vs. prior period
              </div>
            )}
          </div>
          {summary.slaByTier.map((t) => {
            const okPct = t.total > 0 ? ((t.total - t.breached) / t.total) * 100 : 0;
            return (
              <div key={t.tier} className="reporting__slaRow">
                <div style={{ fontSize: 13 }}>
                  {t.tier} <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>({t.targetHours}h target)</span>
                </div>
                <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.total}</div>
                <div>
                  <span className="reporting__slaBarTrack">
                    <span className="reporting__slaBarOk" style={{ width: `${okPct}%` }} />
                  </span>
                  <div style={{ fontSize: 10.5, color: 'var(--color-neutral-700)' }}>
                    {t.total - t.breached} within · {t.breached} breached
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-heading)', fontSize: 16 }}>{t.adherenceRate !== null ? `${(t.adherenceRate * 100).toFixed(1)}%` : '—'}</div>
                {comparePrevious && (
                  <div style={{ textAlign: 'right', fontSize: 12 }}>
                    {t.previousAdherenceRate !== null && t.adherenceRate !== null
                      ? `${t.adherenceRate >= t.previousAdherenceRate ? '+' : '−'}${(Math.abs(t.adherenceRate - t.previousAdherenceRate) * 100).toFixed(1)} pts`
                      : '—'}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="tile reporting__panel">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head reporting__phead">
            <span className="reporting__num">05</span>
            <h4 style={{ margin: 0 }}>Agent workload split</h4>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>
              Share of dispositioned alerts where the officer adopted the agent's recommendation without amendment
            </span>
          </div>
          <div className="tile-body">
            {summary.agentWorkload.totalDispositioned === 0 ? (
              <div className="reporting__muted">No dispositions in this period.</div>
            ) : (
              <>
                <span className="reporting__slaBarTrack" style={{ height: 18 }}>
                  <span
                    className="reporting__slaBarOk"
                    style={{ width: `${(summary.agentWorkload.agreedWithAgent / summary.agentWorkload.totalDispositioned) * 100}%` }}
                  />
                </span>
                <div style={{ display: 'flex', gap: 24, marginTop: 10, fontSize: 12.5 }}>
                  <div>
                    <span className="reporting__legendSwatch" style={{ background: 'var(--color-accent-600)' }} /> Agreed with agent —{' '}
                    <strong>{summary.agentWorkload.agreedWithAgent}</strong> (
                    {((summary.agentWorkload.agreedWithAgent / summary.agentWorkload.totalDispositioned) * 100).toFixed(1)}%)
                  </div>
                  <div>
                    <span className="reporting__legendSwatch" style={{ background: 'var(--color-neutral-500)' }} /> Overrode agent —{' '}
                    <strong>{summary.agentWorkload.overrodeAgent}</strong> (
                    {((summary.agentWorkload.overrodeAgent / summary.agentWorkload.totalDispositioned) * 100).toFixed(1)}%)
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="tile reporting__panel" style={{ background: 'var(--color-neutral-100)' }}>
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head reporting__phead" style={{ background: 'var(--color-bg)' }}>
            <span className="reporting__num">06</span>
            <h4 style={{ margin: 0 }}>Report history</h4>
            <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>
              Fixed at generation and re-downloadable byte-for-byte — figures are never restated after the fact
            </span>
          </div>
          <div className="tile-body">
            {!history || history.length === 0 ? (
              <div className="reporting__muted">No reports generated yet.</div>
            ) : (
              <>
                <div className="reporting__historyHead">
                  <div className="reporting__ahd">Report · period</div>
                  <div className="reporting__ahd">Issued</div>
                  <div className="reporting__ahd">Format · hash</div>
                  <div className="reporting__ahd" style={{ textAlign: 'right' }}>
                    Action
                  </div>
                </div>
                {history.map((h) => (
                  <div key={h.reportId} className="reporting__historyRow">
                    <div>
                      <div style={{ fontSize: 12.5 }}>{h.reportName}</div>
                      <div className="reporting__asOf">{h.periodLabel}</div>
                    </div>
                    <div style={{ fontSize: 12.5 }}>
                      {new Date(h.generatedAt).toLocaleString()}
                      <div className="reporting__asOf">{h.generatedBy}</div>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
                      {h.format.toUpperCase()}
                      <div className="reporting__asOf">{h.contentHash.slice(0, 8)}…{h.contentHash.slice(-4)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <button className="aml-btn" style={{ fontSize: 11.5 }} onClick={() => void handleDownload(h)}>
                        Download
                      </button>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ num, label, value, delta, sub }: { num: string; label: string; value: string; delta: string | null; sub?: string }) {
  return (
    <div className="tile reporting__metricTile">
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className="tile-head reporting__phead">
        <span className="reporting__num">{num}</span>
        <span className="aml-label">{label}</span>
      </div>
      <div className="tile-body">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 30 }}>{value}</span>
          {delta && <span style={{ fontSize: 12, color: 'var(--color-neutral-600)' }}>{delta}</span>}
        </div>
        {sub && <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', marginTop: 6 }}>{sub}</div>}
      </div>
    </div>
  );
}
