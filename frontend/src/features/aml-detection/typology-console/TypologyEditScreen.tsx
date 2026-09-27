import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import {
  discardTypologyDraft,
  getBacktestJob,
  getRegressionRun,
  getTypology,
  openTypologyDraft,
  promoteTypology,
  startTypologyBacktest,
  startTypologyRegression,
  updateTypologyDraft,
} from '../api/client';
import type { BacktestJob, RegressionRun, TypologyDetail, TypologyVersion } from '../api/types';
import { useToast } from '../../../shell/ToastProvider';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { ConfirmDialog, Tile } from '../regulatory-kb/kbShared';
import { TypologyStatusBadge } from './TypologyStatusBadge';
import { ChecklistItem, RegressionResults, RegressionSummary, VersionContent, VersionDiff, VersionTile } from './typologyShared';
import { errorText, isRunning, useCanWriteTypologies } from './typologyUtils';
import './typology-console.css';

const POLL_MS = 3000;

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

/** Screen 4 — Edit (screens/06-typology-rules-console.md). The only
 * place a typology changes: the draft is edited here and promoted from
 * here, and the API refuses Promote without a passing golden-dataset
 * regression for the draft's exact content. Opening a draft is a write,
 * so it's an explicit button, never implicit on load. */
export function TypologyEditScreen() {
  const { code = '' } = useParams();
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite, ready } = useCanWriteTypologies();

  const [detail, setDetail] = useState<TypologyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<RegressionRun | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [backtest, setBacktest] = useState<BacktestJob | null>(null);
  const [dialog, setDialog] = useState<null | 'discard' | 'promote'>(null);
  const [reason, setReason] = useState('');

  const runPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const backtestPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  const reload = useCallback(async () => {
    const d = await getTypology(code);
    setDetail(d);
    setForm(d.draft ? formOf(d.draft) : null);
    setBacktest(d.latestBacktest);
    return d;
  }, [code]);

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
    reload()
      .then((d) => {
        if (d.regression) {
          setRun(d.regression);
          if (isRunning(d.regression)) pollRun(d.regression.runId);
        }
      })
      .catch((err: unknown) => setError(errorText(err)));
    return () => {
      if (runPoll.current) clearInterval(runPoll.current);
      if (backtestPoll.current) clearInterval(backtestPoll.current);
    };
  }, [reload, pollRun]);

  if (ready && !canWrite) return <Navigate to={`${base}/typologies/${code}`} replace />;
  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!detail) return <div className="aml-status">Loading typology…</div>;

  const { live, draft } = detail;
  const title = live?.typologyLabel ?? draft?.typologyLabel ?? code;

  const act = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      return true;
    } catch (err) {
      toast.error(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const header = (
    <div className="typology-head">
      <div className="typology-head__main">
        <div className="typology-head__title">
          Edit {title}
          <TypologyStatusBadge status={detail.status} killSwitched={detail.killSwitched} />
        </div>
        <div className="typology-muted">
          {code} · {live ? `v${live.version} live` : 'never promoted'}
          {draft && ` · editing draft v${draft.version}`}
        </div>
      </div>
      <div className="typology-head__actions">
        <Link className="aml-btn" to={`${base}/typologies/${code}`}>
          Back to typology
        </Link>
      </div>
    </div>
  );

  if (!draft || !form) {
    return (
      <div className="typology-screen">
        {header}
        <div className="typology-scroll">
          <Tile title="No draft open">
            <p style={{ margin: '0 0 10px', fontSize: 13 }}>
              Changes are made on a draft copy; the live version keeps running until the draft is promoted.
            </p>
            <button
              className="aml-btn aml-btn--primary"
              disabled={busy}
              onClick={() =>
                void act(() => openTypologyDraft(code), 'Draft opened.').then((ok) => {
                  if (ok) void reload();
                })
              }
            >
              {live ? `Open a draft from live v${live.version}` : 'Open a new draft'}
            </button>
          </Tile>
        </div>
      </div>
    );
  }

  const dirty =
    form.typologyLabel !== draft.typologyLabel ||
    form.ruleLogicDescription !== draft.ruleLogicDescription ||
    form.active !== draft.active ||
    form.changeReason !== draft.changeReason;
  const runForDraft = run && run.candidateKey?.includes(`:v${draft.version}:`) ? run : null;
  const reasonOk = !!draft.changeReason.trim();
  const regressionOk = runForDraft?.status === 'passed' && !runForDraft.stale && !dirty;
  const backtestLinked = backtest?.status === 'complete' ? backtest : null;

  const save = () =>
    act(
      () =>
        updateTypologyDraft(code, {
          typology_label: form.typologyLabel,
          rule_logic_description: form.ruleLogicDescription,
          active: form.active,
          change_reason: form.changeReason,
        }),
      'Draft saved — not live until promoted.',
    ).then((ok) => {
      if (ok) {
        void reload().then((d) => setRun((prev) => (prev ? { ...prev, stale: prev.candidateKey !== d.draft?.candidateKey } : prev)));
      }
    });

  const startRegression = async () => {
    setBusy(true);
    try {
      const { runId, candidateKey } = await startTypologyRegression(code);
      setRun({ runId, status: 'queued', candidateKey, done: 0, total: null, passed: 0, failed: 0, triggeredBy: null, startedAt: null, completedAt: null, stale: false });
      setShowResults(false);
      pollRun(runId);
      toast.success('Golden-dataset regression started.');
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleResults = async () => {
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

  const startBacktest = async () => {
    try {
      const job = await startTypologyBacktest(code);
      setBacktest(job);
      if (backtestPoll.current) clearInterval(backtestPoll.current);
      backtestPoll.current = setInterval(() => {
        void getBacktestJob(job.jobId).then((updated) => {
          setBacktest(updated);
          if (updated.status === 'complete' || updated.status === 'failed') {
            if (backtestPoll.current) clearInterval(backtestPoll.current);
            toast[updated.status === 'complete' ? 'success' : 'error'](`Backtest ${updated.status}.`);
          }
        });
      }, 1500);
    } catch (err) {
      toast.error(errorText(err));
    }
  };

  const promote = async () => {
    const ok = await act(
      () => promoteTypology(code, { backtest_job_id: backtestLinked?.jobId, reason: reason.trim() }),
      draft.active ? `Promoted v${draft.version} — the agent now uses it.` : `Promoted v${draft.version} — the typology is retired.`,
    );
    if (ok) navigate(`${base}/typologies/${code}`);
  };

  const discard = async () => {
    const ok = await act(() => discardTypologyDraft(code, reason.trim()), 'Draft discarded — the live version is unchanged.');
    if (ok) navigate(`${base}/typologies/${code}`);
  };

  return (
    <div className="typology-screen">
      {header}
      <div className="typology-banner">Draft v{draft.version} — nothing here affects live detection until it is promoted.</div>

      <div className="typology-scroll">
        <div className="typology-detail__versions">
          <VersionTile
            kind="draft"
            title={`Draft — v${draft.version}`}
            note={dirty ? 'Unsaved changes' : `Saved by ${draft.changedBy}`}
          >
            <label className="typology-console__field">
              Label
              <input value={form.typologyLabel} onChange={(e) => setForm({ ...form, typologyLabel: e.target.value })} />
            </label>
            <label className="typology-console__field">
              Rule logic (plain language — this is what the agent reads)
              <textarea
                className="input"
                rows={7}
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
              <button className="aml-btn aml-btn--primary" disabled={busy || !dirty} onClick={() => void save()}>
                Save draft
              </button>
              {dirty && (
                <button className="aml-btn" disabled={busy} onClick={() => setForm(formOf(draft))}>
                  Revert
                </button>
              )}
              <button
                className="aml-btn typology-danger"
                style={{ marginLeft: 'auto' }}
                disabled={busy}
                onClick={() => {
                  setReason('');
                  setDialog('discard');
                }}
              >
                Discard draft…
              </button>
            </div>
          </VersionTile>

          <VersionTile kind="live" title={live ? `Live — v${live.version}` : 'Not live'} note="For reference">
            {live ? <VersionContent version={live} /> : <div className="typology-muted">Never promoted — this draft would be its first live version.</div>}
          </VersionTile>
        </div>

        {live && (
          <Tile title={`Saved draft v${draft.version} vs. live v${live.version}`}>
            <VersionDiff older={live} newer={draft} />
          </Tile>
        )}

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
                Runs every golden case through the real agent with this draft in the catalog. Each case is a live model call, so this takes a few
                minutes.
              </div>
              {runForDraft && (
                <div className="typology-console__jobStatus">
                  <RegressionSummary run={runForDraft} />
                  {runForDraft.total != null && isRunning(runForDraft) && (
                    <div className="typology-detail__progress">
                      <span style={{ width: `${runForDraft.total ? (runForDraft.done / runForDraft.total) * 100 : 0}%` }} />
                    </div>
                  )}
                  {!isRunning(runForDraft) && runForDraft.total != null && (
                    <button className="aml-btn typology-detail__linkBtn" onClick={() => void toggleResults()}>
                      {showResults ? 'Hide case results' : 'Show case results'}
                    </button>
                  )}
                  {showResults && runForDraft.results && <RegressionResults run={runForDraft} />}
                </div>
              )}
              <button
                className="aml-btn"
                style={{ marginTop: 8 }}
                disabled={busy || !reasonOk || dirty || isRunning(runForDraft)}
                onClick={() => void startRegression()}
              >
                {runForDraft ? 'Run regression again' : 'Run golden-dataset regression'}
              </button>
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
              <button
                className="aml-btn"
                style={{ marginTop: 8 }}
                disabled={backtest?.status === 'queued' || backtest?.status === 'running'}
                onClick={() => void startBacktest()}
              >
                Start backtest
              </button>
            </ChecklistItem>

            <ChecklistItem ok={detail.goldenCoverage > 0} optional title="Golden cases cover this typology">
              {detail.goldenCoverage > 0
                ? `${detail.goldenCoverage} golden case(s) expect this typology.`
                : 'No golden case expects this typology yet, so the regression only proves the other typologies are undisturbed. Add cases in Model Governance → golden dataset.'}
            </ChecklistItem>
          </ol>

          <div className="typology-console__promoteSection">
            <button
              className="aml-btn aml-btn--primary"
              disabled={busy || !regressionOk || !reasonOk}
              onClick={() => {
                setReason('');
                setDialog('promote');
              }}
            >
              Promote v{draft.version} to production…
            </button>
            {!regressionOk && (
              <div style={{ fontSize: 11.5, color: 'var(--color-accent-800)', marginTop: 4 }}>Locked until the regression passes for the draft as it is now.</div>
            )}
          </div>
        </div>
      </div>

      {dialog === 'discard' && (
        <ConfirmDialog
          title={`Discard draft v${draft.version}?`}
          confirmLabel="Discard"
          busy={busy}
          disabled={!reason.trim()}
          onCancel={() => setDialog(null)}
          onConfirm={() => void discard()}
        >
          <p style={{ margin: '0 0 8px' }}>The draft is kept in the version history as discarded; the live version is unchanged.</p>
          <label className="typology-console__field">
            Reason (required)
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmDialog>
      )}

      {dialog === 'promote' && (
        <ConfirmDialog
          title={`Promote ${draft.typologyLabel} v${draft.version} to production?`}
          confirmLabel={`Promote v${draft.version}`}
          busy={busy}
          disabled={!reason.trim()}
          onCancel={() => setDialog(null)}
          onConfirm={() => void promote()}
        >
          <p style={{ margin: '0 0 8px' }}>
            {draft.active
              ? live
                ? `This replaces live v${live.version} in the agent's catalog for every alert from now on.`
                : "This adds the typology to the agent's catalog for every alert from now on."
              : 'This retires the typology — the agent stops matching against it. Its history and past matches are kept.'}
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
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </ConfirmDialog>
      )}
    </div>
  );
}
