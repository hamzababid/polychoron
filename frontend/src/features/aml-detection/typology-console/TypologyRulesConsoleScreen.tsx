import { useCallback, useEffect, useRef, useState } from 'react';
import { getBacktestJob, getTypologyHistory, listTypologies, promoteTypology, startTypologyBacktest, updateTypology } from '../api/client';
import type { BacktestJob, TypologyConfigVersion, TypologyRow } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../shell/ToastProvider';
import './typology-console.css';

const CAN_WRITE_ROLES = ['aml_detection.mlro_compliance_head'];

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * "Live vs. draft must be visually unmistakable" — active typologies
 * get a solid green rail, inactive ones a hatched/grey one, never the
 * same treatment. */
export function TypologyRulesConsoleScreen() {
  const { session } = useAuth();
  const toast = useToast();
  const canWrite = session ? CAN_WRITE_ROLES.some((r) => session.user.roleCodes.includes(r)) : false;

  const [rows, setRows] = useState<TypologyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [history, setHistory] = useState<TypologyConfigVersion[] | null>(null);
  const [draftDescription, setDraftDescription] = useState('');
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [backtestJob, setBacktestJob] = useState<BacktestJob | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [promoteReason, setPromoteReason] = useState('');
  const [promoting, setPromoting] = useState(false);

  const load = useCallback(() => {
    listTypologies()
      .then(setRows)
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

  const selected = rows?.find((r) => r.typologyCode === selectedCode) ?? null;

  const selectTypology = (code: string) => {
    setSelectedCode(code);
    setBacktestJob(null);
    setPromoteReason('');
    const row = rows?.find((r) => r.typologyCode === code);
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
      // These used to feed the same `error` state the initial load
      // does, replacing the whole table + detail panel for what's
      // really a transient action failure on one typology.
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
    setPromoting(true);
    try {
      await promoteTypology(selected.typologyCode, {
        backtest_job_id: backtestJob?.status === 'complete' ? backtestJob.jobId : undefined,
        reason: promoteReason,
        promoted_by: session.user.userId,
      });
      setPromoteReason('');
      load();
      toast.success('Promoted to production.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setPromoting(false);
    }
  };

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!rows) return <div className="aml-status">Loading typology console…</div>;

  return (
    <div className="typology-console">
      <table className="typology-console__table">
        <thead>
          <tr>
            <th></th>
            <th>Typology</th>
            <th>Version</th>
            <th>Alerts (30d)</th>
            <th>STR conversion</th>
            <th>False positive rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.typologyCode}
              className={`typology-console__row ${r.active ? 'typology-console__row--live' : 'typology-console__row--draft'} ${selectedCode === r.typologyCode ? 'typology-console__row--selected' : ''}`}
              onClick={() => selectTypology(r.typologyCode)}
            >
              <td>
                <span className={r.active ? 'typology-console__liveBadge' : 'typology-console__draftBadge'}>
                  {r.active ? 'LIVE' : 'INACTIVE'}
                </span>
              </td>
              <td>{r.typologyLabel}</td>
              <td>v{r.productionVersion}</td>
              <td>{r.alertVolume30d}</td>
              <td>{(r.strConversionRate * 100).toFixed(0)}%</td>
              <td>{(r.falsePositiveRate * 100).toFixed(0)}%</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selected && (
        <div className="typology-console__detail aml-card">
          <div className="aml-label">{selected.typologyLabel} — detail</div>

          <label className="typology-console__field">
            Rule logic description
            <textarea
              value={draftDescription}
              onChange={(e) => setDraftDescription(e.target.value)}
              rows={4}
              disabled={!canWrite}
            />
          </label>

          {canWrite && (
            <>
              <label className="typology-console__field">
                Change reason (required to save)
                <input value={changeReason} onChange={(e) => setChangeReason(e.target.value)} />
              </label>
              <div className="typology-console__actions">
                <button className="aml-btn aml-btn--primary" disabled={saving || !changeReason} onClick={() => void handleSave()}>
                  Save rule-logic edit
                </button>
                <button className="aml-btn" disabled={saving} onClick={() => void handleSave(!selected.active)}>
                  {selected.active ? 'Deactivate' : 'Activate'}
                </button>
              </div>
            </>
          )}

          <div className="typology-console__historySection">
            <div className="aml-label">Version history</div>
            {history?.map((v) => (
              <div key={v.versionId} className="typology-console__historyRow">
                v{v.version} · {v.active ? 'active' : 'inactive'} · {v.changeReason} — {v.changedBy},{' '}
                {new Date(v.changedAt).toLocaleString()}
              </div>
            ))}
          </div>

          {canWrite && (
            <div className="typology-console__backtestSection">
              <div className="aml-label">Backtest</div>
              <button className="aml-btn" onClick={() => void handleBacktest()} disabled={backtestJob?.status === 'running'}>
                Start backtest
              </button>
              {backtestJob && (
                <div className="typology-console__jobStatus">
                  Status: <strong>{backtestJob.status}</strong>
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
                </div>
              )}

              <div className="typology-console__promoteSection">
                <div className="aml-label">Promote to production</div>
                {!backtestJob && <div className="typology-console__promoteWarning">No backtest run yet for this session — the promotion will be flagged as unlinked.</div>}
                <input
                  className="typology-console__promoteReason"
                  placeholder="Reason for promotion (required)"
                  value={promoteReason}
                  onChange={(e) => setPromoteReason(e.target.value)}
                />
                <button className="aml-btn aml-btn--primary" disabled={promoting || !promoteReason.trim()} onClick={() => void handlePromote()}>
                  {promoting ? 'Promoting…' : 'Promote'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
