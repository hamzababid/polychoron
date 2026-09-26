import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  discardTypologyDraft,
  getBacktestJob,
  getRegressionRun,
  getTypology,
  getTypologyHistory,
  openTypologyDraft,
  promoteTypology,
  startTypologyBacktest,
  startTypologyRegression,
  updateTypologyDraft,
} from '../api/client';
import type { BacktestJob, KillSwitchScope, RegressionRun, TypologyDetail, TypologyHistory, TypologyVersion } from '../api/types';
import { wordDiff } from '../regulatory-kb/wordDiff';
import { useToast } from '../../../shell/ToastProvider';
import { TypologyStatusBadge } from './TypologyStatusBadge';

const POLL_MS = 3000;

interface Props {
  code: string;
  canWrite: boolean;
  killSwitch: KillSwitchScope | null;
  killSwitchBusy: boolean;
  onDisableKillSwitch: () => void;
  onReactivateKillSwitch: (scope: KillSwitchScope) => void;
  // The overview table reloads after any write here.
  onChanged: () => void;
}

interface DraftForm {
  typologyLabel: string;
  ruleLogicDescription: string;
  active: boolean;
  changeReason: string;
}

const formOf = (v: TypologyVersion): DraftForm => ({
  typologyLabel: v.typologyLabel,
  ruleLogicDescription: v.ruleLogicDescription,
  active: v.active,
  changeReason: v.changeReason,
});

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
const isRunning = (run: RegressionRun | null) => run?.status === 'queued' || run?.status === 'running';

/** screens/06-typology-rules-console.md — "Detail panel". Live content
 * is read-only (solid rail); the draft is the only editable thing
 * (hatched), and nothing here changes what the agent sees until
 * Promote succeeds — which the API refuses without a passing golden-
 * dataset regression for the draft's exact content. */
export function TypologyDetailPanel({
  code,
  canWrite,
  killSwitch,
  killSwitchBusy,
  onDisableKillSwitch,
  onReactivateKillSwitch,
  onChanged,
}: Props) {
  const toast = useToast();
  const [detail, setDetail] = useState<TypologyDetail | null>(null);
  const [history, setHistory] = useState<TypologyHistory | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [busy, setBusy] = useState(false);

  const [run, setRun] = useState<RegressionRun | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [backtest, setBacktest] = useState<BacktestJob | null>(null);

  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardReason, setDiscardReason] = useState('');
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteReason, setPromoteReason] = useState('');

  const runPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const backtestPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    const [d, h] = await Promise.all([getTypology(code), getTypologyHistory(code)]);
    setDetail(d);
    setHistory(h);
    setForm(d.draft ? formOf(d.draft) : null);
    setBacktest(d.latestBacktest);
    return d;
  }, [code]);

  const stopPolling = () => {
    if (runPoll.current) clearInterval(runPoll.current);
    if (backtestPoll.current) clearInterval(backtestPoll.current);
    runPoll.current = null;
    backtestPoll.current = null;
  };

  const pollRun = useCallback(
    (runId: string) => {
      if (runPoll.current) clearInterval(runPoll.current);
      const tick = async () => {
        try {
          const updated = await getRegressionRun(runId);
          if (isRunning(updated)) {
            setRun((prev) => ({ ...updated, stale: prev?.stale }));
            return;
          }
          if (runPoll.current) clearInterval(runPoll.current);
          runPoll.current = null;
          const d = await reload();
          setRun({ ...updated, stale: d.regression?.runId === runId ? d.regression.stale : true });
          toast[updated.status === 'passed' ? 'success' : 'error'](`Golden-dataset regression ${updated.status}.`);
        } catch (err) {
          toast.error(errorText(err));
        }
      };
      void tick();
      runPoll.current = setInterval(() => void tick(), POLL_MS);
    },
    [reload, toast],
  );

  useEffect(() => {
    stopPolling();
    setRun(null);
    setShowResults(false);
    setDiscardOpen(false);
    setPromoteOpen(false);
    reload()
      .then((d) => {
        if (d.regression) {
          setRun(d.regression);
          if (isRunning(d.regression)) pollRun(d.regression.runId);
        }
      })
      .catch((err: unknown) => toast.error(errorText(err)));
    return stopPolling;
    // Re-run only when the selected typology changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      onChanged();
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!detail || !history) {
    return <div className="typology-console__muted" style={{ padding: 14 }}>Loading typology…</div>;
  }

  const { live, draft } = detail;
  const dirty =
    !!draft &&
    !!form &&
    (form.typologyLabel !== draft.typologyLabel ||
      form.ruleLogicDescription !== draft.ruleLogicDescription ||
      form.active !== draft.active ||
      form.changeReason !== draft.changeReason);

  const runForDraft = run && draft && run.candidateKey?.includes(`:v${draft.version}:`) ? run : null;
  const regressionOk = runForDraft?.status === 'passed' && !runForDraft.stale && !dirty;
  const reasonOk = !!draft?.changeReason.trim();
  const backtestLinked = backtest?.status === 'complete' ? backtest : null;

  const handleSave = () =>
    form &&
    act(
      () =>
        updateTypologyDraft(code, {
          typology_label: form.typologyLabel,
          rule_logic_description: form.ruleLogicDescription,
          active: form.active,
          change_reason: form.changeReason,
        }),
      'Draft saved — it is not live until promoted.',
    );

  const handleStartRegression = async () => {
    setBusy(true);
    try {
      const { runId } = await startTypologyRegression(code);
      setRun({ runId, status: 'queued', candidateKey: draft?.candidateKey ?? null, done: 0, total: null, passed: 0, failed: 0, triggeredBy: null, startedAt: null, completedAt: null, stale: false });
      setShowResults(false);
      pollRun(runId);
      toast.success('Golden-dataset regression started.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const handleStartBacktest = async () => {
    try {
      const job = await startTypologyBacktest(code);
      setBacktest(job);
      if (backtestPoll.current) clearInterval(backtestPoll.current);
      backtestPoll.current = setInterval(() => {
        void getBacktestJob(job.jobId).then((updated) => {
          setBacktest(updated);
          if (updated.status === 'complete' || updated.status === 'failed') {
            if (backtestPoll.current) clearInterval(backtestPoll.current);
            onChanged();
            toast[updated.status === 'complete' ? 'success' : 'error'](`Backtest ${updated.status}.`);
          }
        });
      }, 1500);
      onChanged();
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const handleShowResults = async () => {
    if (!runForDraft) return;
    if (!runForDraft.results) {
      try {
        const full = await getRegressionRun(runForDraft.runId);
        setRun({ ...full, stale: runForDraft.stale });
      } catch (err) {
        toast.error(errorText(err));
        return;
      }
    }
    setShowResults((v) => !v);
  };

  const handlePromote = async () => {
    const ok = await act(
      () => promoteTypology(code, { backtest_job_id: backtestLinked?.jobId, reason: promoteReason.trim() }),
      `Promoted v${draft?.version} — the agent now uses it.`,
    );
    if (ok) {
      setPromoteOpen(false);
      setPromoteReason('');
      setRun(null);
    }
  };

  const handleDiscard = async () => {
    const ok = await act(() => discardTypologyDraft(code, discardReason.trim()), 'Draft discarded.');
    if (ok) {
      setDiscardOpen(false);
      setDiscardReason('');
      setRun(null);
    }
  };

  const title = live?.typologyLabel ?? draft?.typologyLabel ?? code;

  return (
    <div className="typology-detail">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11, flexWrap: 'wrap' }}>
        <h5 style={{ margin: 0, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 13 }}>Rule detail</h5>
        <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
          {title} · {code}
        </span>
        <TypologyStatusBadge status={detail.status} killSwitched={detail.killSwitched} />
      </div>

      <div className="typology-detail__versions">
        <VersionTile
          kind="live"
          heading={live ? `Live — v${live.version}` : 'Not live yet'}
          note={
            live
              ? live.active
                ? 'What the Pattern Matching Agent uses on every alert.'
                : 'Retired — not offered to the agent.'
              : 'Never promoted — the agent has never seen this typology.'
          }
        >
          {live ? (
            <>
              <div className="typology-detail__label">{live.typologyLabel}</div>
              <p className="typology-detail__text">{live.ruleLogicDescription}</p>
              <div className="typology-console__muted">
                Last changed by {live.changedBy}, {new Date(live.changedAt).toLocaleDateString()} — “{live.changeReason}”
              </div>
            </>
          ) : (
            <div className="typology-console__muted">Promote the draft to put it into the agent's catalog.</div>
          )}
        </VersionTile>

        <VersionTile kind="draft" heading={draft ? `Draft — v${draft.version}` : 'No open draft'} note="Not affecting live detection.">
          {draft && form ? (
            canWrite ? (
              <>
                <label className="typology-console__field">
                  Label
                  <input value={form.typologyLabel} onChange={(e) => setForm({ ...form, typologyLabel: e.target.value })} />
                </label>
                <label className="typology-console__field">
                  Rule logic (plain language — this is what the agent reads)
                  <textarea
                    className="input"
                    rows={5}
                    value={form.ruleLogicDescription}
                    onChange={(e) => setForm({ ...form, ruleLogicDescription: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                  />
                </label>
                <label className="typology-detail__check">
                  <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Active — offered to the agent once promoted (untick to retire)
                </label>
                <label className="typology-console__field">
                  What changed and why (required before the regression)
                  <input value={form.changeReason} onChange={(e) => setForm({ ...form, changeReason: e.target.value })} />
                </label>
                <div className="typology-console__actions">
                  <button className="aml-btn aml-btn--primary" disabled={busy || !dirty} onClick={() => void handleSave()}>
                    Save draft
                  </button>
                  {dirty && (
                    <button className="aml-btn" disabled={busy} onClick={() => setForm(formOf(draft))}>
                      Revert
                    </button>
                  )}
                  <button className="aml-btn" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => setDiscardOpen(true)}>
                    Discard draft…
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="typology-detail__label">{draft.typologyLabel}</div>
                <p className="typology-detail__text">{draft.ruleLogicDescription}</p>
                <div className="typology-console__muted">
                  {draft.active ? 'Active' : 'Retiring'} · {draft.changedBy}, {new Date(draft.changedAt).toLocaleDateString()} — “
                  {draft.changeReason || 'no reason yet'}”
                </div>
              </>
            )
          ) : canWrite ? (
            <button className="aml-btn" disabled={busy} onClick={() => void act(() => openTypologyDraft(code), 'Draft opened from the live version.')}>
              Edit — open a draft
            </button>
          ) : (
            <div className="typology-console__muted">No change is in progress.</div>
          )}
        </VersionTile>
      </div>

      {draft && live && <DraftDiff live={live} draft={draft} />}

      {draft && (
        <div className="typology-console__backtestPanel">
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 11, flexWrap: 'wrap' }}>
            <h5 style={{ margin: 0, letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 13, color: 'var(--color-accent-800)' }}>
              Promotion checklist
            </h5>
            <span className="typology-console__draftPill">DRAFT v{draft.version} — NOT LIVE</span>
          </div>

          <ol className="typology-detail__checklist">
            <ChecklistItem ok={reasonOk && !dirty} title="Change reason saved">
              {dirty ? 'Unsaved edits — save the draft first.' : reasonOk ? `“${draft.changeReason}”` : 'Say what changed and why, then save.'}
            </ChecklistItem>

            <ChecklistItem ok={regressionOk} title="Golden-dataset regression passed (required)">
              <div>
                Runs every golden case through the real agent with this draft in the catalog. Each case is a live model call, so this
                takes a few minutes.
              </div>
              {runForDraft && (
                <div className="typology-console__jobStatus">
                  Status: <strong>{runForDraft.status}</strong>
                  {runForDraft.total != null && ` · ${runForDraft.done}/${runForDraft.total} cases`}
                  {!isRunning(runForDraft) && ` · ${runForDraft.passed} passed, ${runForDraft.failed} failed`}
                  {runForDraft.stale && <span className="typology-detail__stale"> STALE — the draft changed after this run</span>}
                  {runForDraft.total != null && isRunning(runForDraft) && (
                    <div className="typology-detail__progress">
                      <span style={{ width: `${runForDraft.total ? (runForDraft.done / runForDraft.total) * 100 : 0}%` }} />
                    </div>
                  )}
                  {!isRunning(runForDraft) && runForDraft.total != null && (
                    <button className="aml-btn typology-detail__linkBtn" onClick={() => void handleShowResults()}>
                      {showResults ? 'Hide case results' : 'Show case results'}
                    </button>
                  )}
                  {showResults && runForDraft.results && <RegressionResults run={runForDraft} />}
                </div>
              )}
              {canWrite && (
                <button
                  className="aml-btn"
                  style={{ marginTop: 8 }}
                  disabled={busy || !reasonOk || dirty || isRunning(runForDraft)}
                  onClick={() => void handleStartRegression()}
                >
                  {runForDraft ? 'Run regression again' : 'Run golden-dataset regression'}
                </button>
              )}
            </ChecklistItem>

            <ChecklistItem ok={!!backtestLinked} optional title="Historical backtest (optional — flagged if skipped)">
              {backtest ? (
                <div className="typology-console__jobStatus">
                  Status: <strong>{backtest.status}</strong>
                  {backtest.comparisonReport && (
                    <div className="typology-console__report">
                      <div>Sample size: {backtest.comparisonReport.sampleSize}</div>
                      <div>
                        Production agreement rate:{' '}
                        {backtest.comparisonReport.productionAgreementRate !== null
                          ? `${(backtest.comparisonReport.productionAgreementRate * 100).toFixed(0)}%`
                          : 'n/a (no historical dispositions yet)'}
                      </div>
                      <div className="typology-console__reportMethod">{backtest.comparisonReport.method}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div>No backtest yet — a promotion without one is recorded as unlinked.</div>
              )}
              {canWrite && (
                <button
                  className="aml-btn"
                  style={{ marginTop: 8 }}
                  disabled={backtest?.status === 'queued' || backtest?.status === 'running'}
                  onClick={() => void handleStartBacktest()}
                >
                  Start backtest
                </button>
              )}
            </ChecklistItem>

            <ChecklistItem ok={detail.goldenCoverage > 0} optional title="Golden cases cover this typology">
              {detail.goldenCoverage > 0
                ? `${detail.goldenCoverage} golden case(s) expect this typology.`
                : 'No golden case expects this typology yet, so the regression only proves the other typologies are undisturbed. Add cases in Model Governance → golden dataset.'}
            </ChecklistItem>
          </ol>

          {canWrite && (
            <div className="typology-console__promoteSection">
              <button className="aml-btn aml-btn--primary" disabled={busy || !regressionOk || !reasonOk} onClick={() => setPromoteOpen(true)}>
                Promote v{draft.version} to production…
              </button>
              {!regressionOk && (
                <div style={{ fontSize: 11.5, color: 'var(--color-accent-800)', marginTop: 4 }}>
                  Locked until the regression passes for the draft as it is now.
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="typology-detail__killSwitch">
        <span className="aml-label" style={{ color: killSwitch ? 'var(--color-alert)' : undefined }}>
          Kill switch — immediate, not versioned
        </span>
        {killSwitch ? (
          <>
            <span style={{ fontSize: 12, color: 'var(--color-alert)' }}>
              Disabled — excluded from Pattern Matching's catalog regardless of version. “{killSwitch.reason}”
            </span>
            {canWrite && (
              <button className="aml-btn" disabled={killSwitchBusy} onClick={() => onReactivateKillSwitch(killSwitch)}>
                Reactivate…
              </button>
            )}
          </>
        ) : (
          canWrite && (
            <button className="aml-btn" disabled={killSwitchBusy} onClick={onDisableKillSwitch}>
              Disable this typology now…
            </button>
          )
        )}
      </div>

      <HistoryTile history={history} productionVersion={detail.productionVersion} />

      {discardOpen && draft && (
        <Dialog title={`Discard draft v${draft.version}?`}>
          <p style={{ margin: '0 0 8px' }}>The draft is kept in the version history as discarded; the live version is unchanged.</p>
          <label className="typology-console__field">
            Reason (required)
            <input autoFocus value={discardReason} onChange={(e) => setDiscardReason(e.target.value)} />
          </label>
          <div className="typology-detail__dialogActions">
            <button className="aml-btn" onClick={() => setDiscardOpen(false)}>
              Cancel
            </button>
            <button className="aml-btn aml-btn--primary" disabled={busy || !discardReason.trim()} onClick={() => void handleDiscard()}>
              Discard
            </button>
          </div>
        </Dialog>
      )}

      {promoteOpen && draft && (
        <Dialog title={`Promote ${draft.typologyLabel} v${draft.version} to production?`}>
          <p style={{ margin: '0 0 8px' }}>
            {draft.active
              ? live
                ? `This replaces live v${live.version} in the agent's catalog for every alert from now on.`
                : "This adds the typology to the agent's catalog for every alert from now on."
              : "This retires the typology — the agent stops matching against it. Its history and past matches are kept."}
          </p>
          <div className="typology-detail__summary">
            Regression: run {runForDraft?.runId.slice(0, 8)} — passed {runForDraft?.passed}/{runForDraft?.total}
            <br />
            Backtest linked:{' '}
            {backtestLinked ? `job ${backtestLinked.jobId.slice(0, 8)}` : <span style={{ color: 'var(--color-alert)' }}>none — will be flagged</span>}
            {detail.goldenCoverage === 0 && (
              <>
                <br />
                <span style={{ color: 'var(--color-alert)' }}>No golden case covers this typology.</span>
              </>
            )}
          </div>
          <label className="typology-console__field" style={{ marginTop: 10 }}>
            Reason for promotion (required, recorded permanently)
            <input autoFocus value={promoteReason} onChange={(e) => setPromoteReason(e.target.value)} />
          </label>
          <div className="typology-detail__dialogActions">
            <button className="aml-btn" onClick={() => setPromoteOpen(false)}>
              Cancel
            </button>
            <button className="aml-btn aml-btn--primary" disabled={busy || !promoteReason.trim()} onClick={() => void handlePromote()}>
              Promote v{draft.version}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function VersionTile({ kind, heading, note, children }: { kind: 'live' | 'draft'; heading: string; note: string; children: ReactNode }) {
  return (
    <div className={`tile typology-version typology-version--${kind}`}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className="tile-head" style={{ borderBottom: '1px solid var(--color-divider)' }}>
        <h6 style={{ margin: 0 }}>{heading}</h6>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-neutral-700)' }}>{note}</span>
      </div>
      <div className="tile-body">{children}</div>
    </div>
  );
}

function DraftDiff({ live, draft }: { live: TypologyVersion; draft: TypologyVersion }) {
  const labelChanged = live.typologyLabel !== draft.typologyLabel;
  const textChanged = live.ruleLogicDescription !== draft.ruleLogicDescription;
  const activeChanged = live.active !== draft.active;
  return (
    <div className="typology-detail__diff">
      <div className="aml-label">
        Saved draft v{draft.version} vs. live v{live.version}
      </div>
      {!labelChanged && !textChanged && !activeChanged ? (
        <div className="typology-console__muted">No differences saved yet.</div>
      ) : (
        <>
          {activeChanged && <div className="typology-detail__diffNote">{draft.active ? 'Re-activates the typology.' : 'Retires the typology.'}</div>}
          {labelChanged && <DiffText older={live.typologyLabel} newer={draft.typologyLabel} />}
          {textChanged && <DiffText older={live.ruleLogicDescription} newer={draft.ruleLogicDescription} />}
        </>
      )}
    </div>
  );
}

function DiffText({ older, newer }: { older: string; newer: string }) {
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

function ChecklistItem({ ok, optional, title, children }: { ok: boolean; optional?: boolean; title: string; children: ReactNode }) {
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

function RegressionResults({ run }: { run: RegressionRun }) {
  return (
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
        {run.results!.map((r) => (
          <tr key={r.scenarioName}>
            <td>{r.scenarioName}</td>
            <td>
              {r.expectedTypology ?? 'any'} · {r.expectedRecommendation ?? 'any'}
            </td>
            <td>
              {r.actualTypology ?? '—'} · {r.actualRecommendation ?? '—'}
              {r.notes && <div className="typology-console__muted">{r.notes}</div>}
            </td>
            <td style={{ color: r.matchedExpected ? 'var(--color-accent-800)' : 'var(--color-alert)' }}>{r.matchedExpected ? 'pass' : 'fail'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function HistoryTile({ history, productionVersion }: { history: TypologyHistory; productionVersion: number | null }) {
  const promotionsByVersion = new Map(history.promotions.map((p) => [p.promotedVersion, p]));
  return (
    <div className="tile" style={{ marginTop: 14 }}>
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <div className="tile-head" style={{ borderBottom: '1px solid var(--color-divider)' }}>
        <h6 style={{ margin: 0 }}>Version history</h6>
        <span className="tag tag-neutral" style={{ fontSize: 10 }}>
          {history.versions.length} versions · {history.promotions.length} promotions
        </span>
      </div>
      {history.versions.map((v) => {
        const promotion = promotionsByVersion.get(v.version);
        return (
          <div key={v.version} className={`typology-history__row ${v.version === productionVersion ? 'typology-history__row--live' : ''}`}>
            <div style={{ flex: 'none', width: 56 }}>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>v{v.version}</div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)' }}>{new Date(v.changedAt).toLocaleDateString()}</div>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{v.changeReason || <em>no reason yet</em>}</div>
              <div style={{ fontSize: 10.5, color: 'var(--color-neutral-600)', marginTop: 1 }}>
                {v.changedBy} · {v.active ? 'active' : 'inactive'}
                {v.status === 'discarded' && ` · discarded by ${v.discardedBy}: “${v.discardReason}”`}
              </div>
              {promotion && (
                <div style={{ fontSize: 10.5, color: 'var(--color-neutral-700)', marginTop: 2 }}>
                  Promoted by {promotion.promotedBy}, {new Date(promotion.promotedAt).toLocaleDateString()} — “{promotion.reason}” ·{' '}
                  {promotion.preV2 ? 'before regression gating' : `regression ${promotion.evalRunId?.slice(0, 8)}`} ·{' '}
                  {promotion.backtestJobId ? (
                    `backtest ${promotion.backtestJobId.slice(0, 8)}`
                  ) : (
                    <span style={{ color: 'var(--color-alert)' }}>no backtest</span>
                  )}
                </div>
              )}
            </div>
            <span className={`typology-history__status typology-history__status--${v.status}`}>{v.status}</span>
          </div>
        );
      })}
    </div>
  );
}

function Dialog({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="typology-console__dialogBackdrop">
      <div className="tile typology-console__dialog">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div className="tile-head" style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>
          {title}
        </div>
        <div className="tile-body" style={{ fontSize: 13 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
