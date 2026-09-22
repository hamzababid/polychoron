import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getBacktestJob, getTypologyHistory, listTypologies, promoteTypology, startTypologyBacktest, updateTypology } from '../api/client';
import type { BacktestJob, TypologyConfigVersion, TypologyConsoleOverview } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../shell/ToastProvider';
import './typology-console.css';

const CAN_WRITE_ROLES = ['aml_detection.mlro_compliance_head'];
// "Tuning candidates only" (design-exports/.../Typology Rules
// Console.dc.html) flags rules with weak STR conversion — a real
// computed threshold, not user-configurable yet (the mockup exposes
// it as an admin-tunable prop; there's no settings surface for that
// here, so it's a fixed constant instead of a fake control).
const TUNING_CONVERSION_THRESHOLD = 0.1;
const HIGH_FP_THRESHOLD = 0.5;

type StatusFilter = 'all' | 'active' | 'inactive';

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * — restyled to match design-exports/bfsi/aml-detection/Typology
 * Rules Console.dc.html's rule-registry layout (the first pass missed
 * the design export and built a plain data-grid instead).
 *
 * Two things the mockup shows that this build deliberately does NOT
 * fabricate:
 * 1. The mockup's "Detection logic" panel has six structured fields
 *    (trigger threshold, observation window, FMU category, scope,
 *    suppression, risk weighting). aml_typology_configs only stores
 *    one free-text rule_logic_description — there's no column for
 *    those six fields. Real metadata (production version, who/why it
 *    last changed) is shown instead; inventing a taxonomy for fields
 *    that don't exist in the schema would be exactly the kind of
 *    fabricated demo content this project's constitution rules out.
 * 2. The mockup's backtest sandbox shows a full shadow-mode
 *    comparison: alert volume/STR conversion/false-positive rate
 *    before vs. after, a monthly live-vs-draft chart, and a written
 *    model-risk narrative. TypologyConsoleService.startBacktest()
 *    computes one real number — the CURRENT production agreement
 *    rate from historical Case/Disposition data — and says so in its
 *    own comparisonReport.method text (see typology-console.service.ts
 *    for why: a true shadow re-run means re-invoking Pattern Matching
 *    against historical evidence bundles with the draft config, a
 *    larger follow-up, not built yet). That real, narrower number is
 *    what's shown here, not an invented before/after.
 */
export function TypologyRulesConsoleScreen() {
  const { session } = useAuth();
  const toast = useToast();
  const canWrite = session ? CAN_WRITE_ROLES.some((r) => session.user.roleCodes.includes(r)) : false;

  const [overview, setOverview] = useState<TypologyConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tuningOnly, setTuningOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [history, setHistory] = useState<TypologyConfigVersion[] | null>(null);
  const [draftDescription, setDraftDescription] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [backtestJob, setBacktestJob] = useState<BacktestJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [promoteReason, setPromoteReason] = useState('');
  const [promoting, setPromoting] = useState(false);
  const [ackChecked, setAckChecked] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(() => {
    listTypologies()
      .then(setOverview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const rows = overview?.typologies ?? [];
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter === 'active' && !r.active) return false;
      if (statusFilter === 'inactive' && r.active) return false;
      if (tuningOnly && r.strConversionRate >= TUNING_CONVERSION_THRESHOLD) return false;
      if (search.trim() && !`${r.typologyLabel} ${r.typologyCode}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, statusFilter, tuningOnly, search]);

  const selected = rows.find((r) => r.typologyCode === selectedCode) ?? null;

  const selectTypology = (code: string) => {
    setSelectedCode(code);
    setBacktestJob(null);
    setPromoteReason('');
    setAckChecked(false);
    const row = rows.find((r) => r.typologyCode === code);
    setDraftDescription(row?.ruleLogicDescription ?? '');
    setChangeReason('');
    getTypologyHistory(code)
      .then(setHistory)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
  };

  const handleSave = async (activeOverride?: boolean) => {
    if (!selected || !session) return;
    setSaving(true);
    try {
      await updateTypology(selected.typologyCode, {
        rule_logic_description: draftDescription !== selected.ruleLogicDescription ? draftDescription : undefined,
        active: activeOverride,
        change_reason: changeReason || (activeOverride !== undefined ? `Toggled ${activeOverride ? 'active' : 'inactive'}` : 'Rule logic edit'),
        changed_by: session.user.userId,
      });
      setChangeReason('');
      load();
      getTypologyHistory(selected.typologyCode).then(setHistory);
      toast.success(activeOverride === undefined ? 'Rule logic updated.' : activeOverride ? 'Typology activated.' : 'Typology deactivated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleBacktest = async () => {
    if (!selected) return;
    try {
      const job = await startTypologyBacktest(selected.typologyCode);
      setBacktestJob(job);
      setAckChecked(false);
      toast.success('Backtest started.');
      pollRef.current = setInterval(() => {
        void getBacktestJob(job.jobId).then((updated) => {
          setBacktestJob(updated);
          if (updated.status === 'complete' || updated.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            toast[updated.status === 'complete' ? 'success' : 'error'](`Backtest ${updated.status}.`);
          }
        });
      }, 1500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePromote = async () => {
    if (!selected || !session || !promoteReason.trim()) return;
    setConfirmOpen(false);
    setPromoting(true);
    try {
      await promoteTypology(selected.typologyCode, {
        backtest_job_id: backtestJob?.status === 'complete' ? backtestJob.jobId : undefined,
        reason: promoteReason,
        promoted_by: session.user.userId,
      });
      setPromoteReason('');
      setAckChecked(false);
      load();
      toast.success('Promoted to production.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPromoting(false);
    }
  };

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!overview) return <div className="aml-status">Loading typology console…</div>;

  const liveCount = rows.filter((r) => r.active).length;
  const retiredCount = rows.filter((r) => !r.active).length;
  const draftsInBacktestCount = rows.filter((r) => r.hasActiveBacktest).length;
  const alerts30d = rows.reduce((sum, r) => sum + r.alertVolume30d, 0);

  return (
    <div className="typology-console">
      <div className="typology-console__strip">
        <div className="typology-console__stripCell typology-console__stripTitle">
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>Typology &amp; rules console</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>{rows.length} typologies configured</div>
        </div>
        <div className="typology-console__stripCell" style={{ display: 'flex', gap: 24 }}>
          <div>
            <div className="aml-label">Live rules</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{liveCount}</div>
          </div>
          <div>
            <div className="aml-label">Retired</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{retiredCount}</div>
          </div>
          <div>
            <div className="aml-label" style={{ color: draftsInBacktestCount > 0 ? 'var(--color-accent-700)' : undefined }}>
              Drafts in backtest
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20, color: draftsInBacktestCount > 0 ? 'var(--color-accent-700)' : undefined }}>
              {draftsInBacktestCount}
            </div>
          </div>
          <div>
            <div className="aml-label">Alerts last 30d</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{alerts30d}</div>
          </div>
        </div>
        <div className="typology-console__stripCell">
          <div className="aml-label">Change control</div>
          <div style={{ fontSize: 12 }}>
            {overview.lastPromotion
              ? `Last promotion: ${overview.lastPromotion.typologyLabel} v${overview.lastPromotion.promotedVersion} by ${overview.lastPromotion.promotedBy}, ${new Date(overview.lastPromotion.promotedAt).toLocaleDateString()}`
              : 'No promotions recorded yet.'}
          </div>
        </div>
      </div>

      <div className="typology-console__filterBar">
        <span className="aml-label" style={{ marginRight: 2 }}>
          Filter
        </span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">Status: all</option>
          <option value="active">Active</option>
          <option value="inactive">Retired</option>
        </select>
        <label className="typology-console__tuneToggle">
          <input type="checkbox" checked={tuningOnly} onChange={(e) => setTuningOnly(e.target.checked)} />
          Tuning candidates only
          <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>conversion under {(TUNING_CONVERSION_THRESHOLD * 100).toFixed(0)}%</span>
        </label>
        <input
          className="input"
          placeholder="Typology name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', width: 240, fontSize: 12.5 }}
        />
      </div>

      <div className="typology-console__scroll">
        <div className="typology-console__tableHead">
          <div className="typology-console__ahd">Typology · code</div>
          <div className="typology-console__ahd">Status</div>
          <div className="typology-console__ahd" style={{ textAlign: 'right' }}>
            Alerts 30d
          </div>
          <div className="typology-console__ahd">STR conversion</div>
          <div className="typology-console__ahd" style={{ textAlign: 'right' }}>
            False positive
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="typology-console__muted" style={{ padding: '18px 14px' }}>
            No typologies match these filters.
          </div>
        ) : (
          filteredRows.map((r) => (
            <div
              key={r.typologyCode}
              className={`typology-console__row ${r.active ? 'typology-console__row--live' : 'typology-console__row--draft'} ${selectedCode === r.typologyCode ? 'typology-console__row--selected' : ''}`}
              onClick={() => selectTypology(r.typologyCode)}
              style={{ opacity: r.active ? 1 : 0.65 }}
            >
              <div className="typology-console__cell">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.typologyLabel}</span>
                  {r.hasActiveBacktest && (
                    <span className="typology-console__draftBadge">DRAFT IN BACKTEST</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
                  {r.typologyCode} · v{r.productionVersion}
                </div>
              </div>
              <div className="typology-console__cell">
                <span className={r.active ? 'typology-console__liveBadge' : 'typology-console__retiredBadge'}>
                  {r.active ? 'ACTIVE' : 'RETIRED'}
                </span>
              </div>
              <div className="typology-console__cell" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.active ? r.alertVolume30d : '—'}
              </div>
              <div className="typology-console__cell">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontSize: 15,
                      width: 44,
                      color: r.strConversionRate < TUNING_CONVERSION_THRESHOLD ? 'var(--color-accent-700)' : 'var(--color-text)',
                    }}
                  >
                    {(r.strConversionRate * 100).toFixed(1)}%
                  </span>
                  <span style={{ width: 44, height: 8, background: 'var(--color-neutral-300)', flex: 'none' }}>
                    <span
                      style={{
                        display: 'block',
                        height: 8,
                        width: `${Math.min(100, r.strConversionRate * 300)}%`,
                        background: r.strConversionRate < TUNING_CONVERSION_THRESHOLD ? 'var(--color-accent-700)' : 'var(--color-accent-600)',
                      }}
                    />
                  </span>
                </div>
                {r.strConversionRate < TUNING_CONVERSION_THRESHOLD && <div style={{ fontSize: 10.5, color: 'var(--color-accent-700)' }}>tuning candidate</div>}
              </div>
              <div className="typology-console__cell" style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: r.falsePositiveRate > HIGH_FP_THRESHOLD ? 'var(--color-accent-700)' : 'var(--color-text)' }}>
                  {(r.falsePositiveRate * 100).toFixed(1)}%
                </div>
                {r.falsePositiveRate > HIGH_FP_THRESHOLD && <div style={{ fontSize: 10.5, color: 'var(--color-accent-700)' }}>above {(HIGH_FP_THRESHOLD * 100).toFixed(0)}% tolerance</div>}
              </div>
            </div>
          ))
        )}

        {selected && (
          <div className="typology-console__detail">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11 }}>
              <h5 style={{ margin: 0, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 13 }}>Rule detail</h5>
              <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
                {selected.typologyLabel} · {selected.typologyCode} · {selected.active ? 'active' : 'retired'}
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14, alignItems: 'start' }}>
              <div className="tile">
                <i className="corner tl" />
                <i className="corner tr" />
                <i className="corner bl" />
                <i className="corner br" />
                <div className="tile-head" style={{ borderBottom: '1px solid var(--color-divider)' }}>
                  <h6 style={{ margin: 0 }}>Detection logic in plain language</h6>
                  <span className={selected.active ? 'typology-console__liveBadge' : 'typology-console__retiredBadge'}>
                    {selected.active ? 'LIVE — AFFECTING REAL ALERTS' : 'RETIRED — NOT RUNNING'}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-700)' }}>v{selected.productionVersion} in production</span>
                </div>
                <div className="tile-body">
                  <textarea
                    className="input"
                    value={draftDescription}
                    onChange={(e) => setDraftDescription(e.target.value)}
                    rows={4}
                    disabled={!canWrite}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, background: 'var(--color-divider)', marginTop: 11 }}>
                    <div style={{ background: 'var(--color-bg)', padding: '8px 10px' }}>
                      <div className="aml-label">FMU code</div>
                      <div style={{ fontSize: 13.5, marginTop: 2 }}>{selected.typologyCode}</div>
                    </div>
                    <div style={{ background: 'var(--color-bg)', padding: '8px 10px' }}>
                      <div className="aml-label">Alerts (30d)</div>
                      <div style={{ fontSize: 13.5, marginTop: 2 }}>{selected.alertVolume30d}</div>
                    </div>
                    <div style={{ background: 'var(--color-bg)', padding: '8px 10px' }}>
                      <div className="aml-label">STR conversion</div>
                      <div style={{ fontSize: 13.5, marginTop: 2 }}>{(selected.strConversionRate * 100).toFixed(1)}%</div>
                    </div>
                  </div>

                  {canWrite && (
                    <>
                      <label className="typology-console__field" style={{ marginTop: 11 }}>
                        Change reason (required to save)
                        <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
                      </label>
                      <div className="typology-console__actions">
                        <button className="aml-btn aml-btn--primary" disabled={saving || !changeReason} onClick={() => void handleSave()}>
                          Save rule-logic edit
                        </button>
                        <button className="aml-btn" disabled={saving} onClick={() => void handleSave(!selected.active)}>
                          {selected.active ? 'Retire rule' : 'Reactivate'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="tile">
                <i className="corner tl" />
                <i className="corner tr" />
                <i className="corner bl" />
                <i className="corner br" />
                <div className="tile-head" style={{ borderBottom: '1px solid var(--color-divider)' }}>
                  <h6 style={{ margin: 0 }}>Version history</h6>
                  <span className="tag tag-neutral" style={{ fontSize: 10 }}>
                    {history?.length ?? 0} versions
                  </span>
                </div>
                <div>
                  {history?.map((v) => (
                    <div
                      key={v.versionId}
                      style={{
                        display: 'flex',
                        gap: 11,
                        alignItems: 'flex-start',
                        padding: '9px 13px',
                        borderBottom: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                        background: v.version === selected.productionVersion ? 'var(--color-accent-100)' : 'var(--color-bg)',
                      }}
                    >
                      <div style={{ flex: 'none', width: 56 }}>
                        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>v{v.version}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>{new Date(v.changedAt).toLocaleDateString()}</div>
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{v.changeReason}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 1 }}>
                          {v.changedBy} · {v.active ? 'active' : 'inactive'}
                        </div>
                      </div>
                      {v.version === selected.productionVersion && (
                        <div style={{ flex: 'none', fontSize: 11, color: 'var(--color-accent-800)' }}>LIVE</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {canWrite && (
              <div className="typology-console__backtestPanel">
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11 }}>
                  <h5 style={{ margin: 0, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 13, color: 'var(--color-accent-800)' }}>
                    Backtest sandbox
                  </h5>
                  <span className="typology-console__draftPill">DRAFT — NOT AFFECTING LIVE DETECTION</span>
                  <span style={{ fontSize: 12, color: 'var(--color-accent-800)' }}>Nothing in this section raises an alert or touches a customer record.</span>
                </div>

                <button className="aml-btn" onClick={() => void handleBacktest()} disabled={backtestJob?.status === 'running' || backtestJob?.status === 'queued'}>
                  Start backtest
                </button>

                {backtestJob && (
                  <div className="typology-console__jobStatus">
                    <div>
                      Status: <strong>{backtestJob.status}</strong>
                    </div>
                    {backtestJob.comparisonReport && (
                      <div className="typology-console__report">
                        <div>Sample size: {backtestJob.comparisonReport.sampleSize}</div>
                        <div>
                          Production agreement rate:{' '}
                          {backtestJob.comparisonReport.productionAgreementRate !== null
                            ? `${(backtestJob.comparisonReport.productionAgreementRate * 100).toFixed(0)}%`
                            : 'n/a (no historical dispositions yet)'}
                        </div>
                        <div className="typology-console__reportMethod">{backtestJob.comparisonReport.method}</div>
                      </div>
                    )}

                    {backtestJob.status === 'complete' && (
                      <div className="typology-console__ackRow">
                        <div className="typology-console__ackBox" onClick={() => setAckChecked((v) => !v)}>
                          <span className="typology-console__ackCheck">{ackChecked ? '✕' : ''}</span>
                          <div>
                            <div style={{ fontSize: 13 }}>I have read the backtest result and accept it as the basis for promotion.</div>
                            <div style={{ fontSize: 11, color: 'var(--color-accent-700)' }}>Promotion changes live detection from the next batch run.</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="typology-console__promoteSection">
                  <div className="aml-label">Promote to production</div>
                  {!backtestJob && (
                    <div className="typology-console__promoteWarning">No backtest run this session — the promotion will be flagged as unlinked.</div>
                  )}
                  <input
                    className="typology-console__promoteReason"
                    placeholder="Reason for promotion (required)"
                    value={promoteReason}
                    onChange={(e) => setPromoteReason(e.target.value)}
                  />
                  <button
                    className="aml-btn aml-btn--primary"
                    disabled={promoting || !promoteReason.trim() || (backtestJob?.status === 'complete' && !ackChecked)}
                    onClick={() => setConfirmOpen(true)}
                  >
                    Promote
                  </button>
                  {backtestJob?.status === 'complete' && !ackChecked && (
                    <div style={{ fontSize: 11.5, color: 'var(--color-accent-800)', marginTop: 4 }}>
                      Locked until the acknowledgement above is checked.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {confirmOpen && selected && (
        <div className="typology-console__dialogBackdrop">
          <div className="tile typology-console__dialog">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head" style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>
              Promote {selected.typologyLabel} to production?
            </div>
            <div className="tile-body" style={{ fontSize: 13 }}>
              <p style={{ margin: '0 0 8px' }}>This replaces the live detection logic for this typology from the next batch run.</p>
              <div style={{ border: '1px solid var(--color-divider)', background: 'var(--color-neutral-100)', padding: '9px 11px', fontSize: 12.5, lineHeight: 1.6 }}>
                Reason: {promoteReason}
                <br />
                Backtest linked: {backtestJob?.status === 'complete' ? `job ${backtestJob.jobId.slice(0, 8)}` : 'none — will be flagged'}
              </div>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-neutral-700)' }}>
                The change is written to the version history and is auditable at any time.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="aml-btn" onClick={() => setConfirmOpen(false)}>
                  Back to backtest
                </button>
                <button className="aml-btn aml-btn--primary" onClick={() => void handlePromote()}>
                  Promote v{selected.productionVersion + 1}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
