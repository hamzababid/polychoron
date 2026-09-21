import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getActivityLog, getCase, recordDisposition } from '../api/client';
import type { ActivityLogEntry, AgentRecommendation, CaseDetail, DispositionType } from '../api/types';
import { LinkedEntityGraph } from '../shared/LinkedEntityGraph';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './case-workspace.css';

const RECOMMENDATION_TO_DISPOSITION: Record<AgentRecommendation, DispositionType> = {
  clear: 'clear',
  escalate: 'escalate_senior',
  recommend_str: 'file_str',
  recommend_ctr: 'file_ctr',
};

const DISPOSITION_LABELS: Record<DispositionType, string> = {
  clear: 'Clear — no suspicion',
  enhanced_monitoring: 'Enhanced monitoring',
  escalate_senior: 'Escalate to senior officer',
  file_str: 'File STR',
  file_ctr: 'File CTR',
};

const FILING_ROLES = ['aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head'];

/** specs/suites/bfsi/features/aml-detection/screens/03-case-workspace.md
 * — highest-usage screen, built with care per that spec's instruction.
 * The agent's draft_narrative is rendered read-only (distinctly
 * styled, never editable in place) since there's no backend endpoint
 * to persist an edit to it from this screen — the editable narrative
 * that does persist is Filing Console's final_narrative. */
export function CaseWorkspaceScreen() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const { session } = useAuth();
  const [caseDetail, setCaseDetail] = useState<CaseDetail | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showActivityLog, setShowActivityLog] = useState(false);

  const [selectedDisposition, setSelectedDisposition] = useState<DispositionType | ''>('');
  const [officerNotes, setOfficerNotes] = useState('');
  const [overrideReason, setOverrideReason] = useState('');

  const load = useCallback(() => {
    setCaseDetail(null);
    Promise.all([getCase(caseId), getActivityLog(caseId)])
      .then(([detail, log]) => {
        setCaseDetail(detail);
        setActivityLog(log);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="aml-status aml-status--error">Could not load case: {error}</div>;
  if (!caseDetail) return <div className="aml-status">Loading case…</div>;

  const canFile = session ? FILING_ROLES.some((r) => session.user.roleCodes.includes(r)) : false;
  const isDisposed = caseDetail.disposition !== null;
  const recommendedDisposition = caseDetail.assessment
    ? RECOMMENDATION_TO_DISPOSITION[caseDetail.assessment.recommendation]
    : null;
  const isOverride = selectedDisposition !== '' && recommendedDisposition !== null && selectedDisposition !== recommendedDisposition;
  const canSubmit = selectedDisposition !== '' && officerNotes.trim() !== '' && (!isOverride || overrideReason.trim() !== '');

  const dispositionOptions: DispositionType[] = ['clear', 'enhanced_monitoring', 'escalate_senior', ...(canFile ? (['file_str', 'file_ctr'] as DispositionType[]) : [])];

  const handleSubmit = async () => {
    if (!selectedDisposition || !session) return;
    setSubmitting(true);
    setError(null);
    try {
      await recordDisposition(caseId, {
        officer_id: session.user.userId,
        disposition_type: selectedDisposition,
        officer_notes: officerNotes,
        overrides_agent_recommendation: isOverride,
        override_reason: isOverride ? overrideReason : undefined,
      });
      if (selectedDisposition === 'file_str' || selectedDisposition === 'file_ctr') {
        navigate(`${base}/cases/${caseId}/filing`);
      } else {
        load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="case-workspace">
      <div className="case-workspace__left">
        {caseDetail.evidence === null && caseDetail.status !== 'open' && (
          <div className="case-workspace__warning">Evidence is unavailable for this case — showing what's known.</div>
        )}

        {caseDetail.evidence ? (
          <>
            <div className="aml-card">
              <div className="aml-label">Customer summary</div>
              <div className="case-workspace__kyc">
                <div>
                  <strong>{caseDetail.evidence.kyc.customer_name}</strong>
                </div>
                <div>CNIC {caseDetail.evidence.kyc.cnic}</div>
                <div>{caseDetail.evidence.kyc.declared_occupation}</div>
                {caseDetail.evidence.kyc.declared_monthly_turnover !== null && (
                  <div>Declared turnover: {caseDetail.evidence.kyc.declared_monthly_turnover.toLocaleString()} PKR/mo</div>
                )}
                <div>KYC risk: {caseDetail.evidence.kyc.kyc_risk_rating}</div>
                <div>{caseDetail.evidence.kyc.address}</div>
              </div>
            </div>

            <div className="aml-card">
              <div className="aml-label">Transaction timeline</div>
              <table className="case-workspace__table">
                <thead>
                  <tr>
                    <th>Ref</th>
                    <th>Amount</th>
                    <th>Channel</th>
                    <th>Branch</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {caseDetail.evidence.transaction_timeline.map((t) => (
                    <tr key={t.txn_ref}>
                      <td>{t.txn_ref}</td>
                      <td>
                        {t.amount.toLocaleString()} {t.currency}
                      </td>
                      <td>{t.channel}</td>
                      <td>{t.branch_code ?? '—'}</td>
                      <td>{new Date(t.timestamp).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="aml-card">
              <div className="aml-label">Linked entities</div>
              <LinkedEntityGraph centerLabel={caseDetail.evidence.kyc.customer_name} entities={caseDetail.evidence.linked_entities} />
            </div>

            <div className="aml-card">
              <div className="aml-label">Prior cases</div>
              {caseDetail.evidence.prior_cases.length === 0 ? (
                <div className="case-workspace__muted">None on file.</div>
              ) : (
                <ul className="case-workspace__list">
                  {caseDetail.evidence.prior_cases.map((p) => (
                    <li key={p.case_id}>
                      {p.typology} · opened {new Date(p.opened_at).toLocaleDateString()}
                      {p.final_disposition && ` · ${p.final_disposition}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="aml-card">
              <div className="aml-label">Screening results</div>
              {caseDetail.evidence.screening_results.length === 0 ? (
                <div className="case-workspace__muted">Clean — no screening matches.</div>
              ) : (
                <ul className="case-workspace__list">
                  {caseDetail.evidence.screening_results.map((s, i) => (
                    <li key={i}>
                      {s.list_source}: {s.matched_name} ({(s.match_confidence * 100).toFixed(0)}%)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="aml-card aml-status">Evidence is still being assembled by the agent chain…</div>
        )}
      </div>

      <div className="case-workspace__right">
        {caseDetail.typologyMatch && (
          <div className="aml-source-ai">
            <div className="aml-source-ai__label">AI-drafted — typology match</div>
            <div className="case-workspace__typologyLabel">{caseDetail.typologyMatch.typology_label}</div>
            <div className="case-workspace__conf">confidence {(caseDetail.typologyMatch.confidence * 100).toFixed(0)}%</div>
            <p>{caseDetail.typologyMatch.plain_language_rationale}</p>
            <ul className="case-workspace__list">
              {caseDetail.typologyMatch.matched_indicators.map((ind) => (
                <li key={ind.indicator_code}>
                  <strong>{ind.indicator_description}</strong> — {ind.contributing_evidence}
                </li>
              ))}
            </ul>
          </div>
        )}

        {caseDetail.assessment && (
          <div className="aml-source-ai" style={{ marginTop: 10 }}>
            <div className="aml-source-ai__label">AI-drafted — narrative (risk {caseDetail.assessment.risk_score}/100)</div>
            <p>{caseDetail.assessment.draft_narrative}</p>
            <div className="case-workspace__conf">
              Recommendation: {caseDetail.assessment.recommendation.replace('_', ' ')} (confidence{' '}
              {(caseDetail.assessment.recommendation_confidence * 100).toFixed(0)}%)
            </div>
          </div>
        )}

        {isDisposed ? (
          <div className="aml-source-human" style={{ marginTop: 10 }}>
            <div className="aml-source-human__label">Officer disposition</div>
            <div>{DISPOSITION_LABELS[caseDetail.disposition!.disposition_type]}</div>
            <p>{caseDetail.disposition!.officer_notes}</p>
            {caseDetail.disposition!.overrides_agent_recommendation && (
              <p className="case-workspace__overrideNote">Override reason: {caseDetail.disposition!.override_reason}</p>
            )}
            {caseDetail.status === 'pending_filing' && (
              <button className="aml-btn aml-btn--primary" onClick={() => navigate(`${base}/cases/${caseId}/filing`)}>
                Go to Filing Console
              </button>
            )}
          </div>
        ) : (
          <div className="aml-source-human" style={{ marginTop: 10 }}>
            <div className="aml-source-human__label">Officer notes &amp; disposition</div>
            <textarea
              className="case-workspace__notesInput"
              placeholder="Officer notes (separate from the agent narrative above, never overwritten by it)"
              value={officerNotes}
              onChange={(e) => setOfficerNotes(e.target.value)}
              rows={3}
            />
            <div className="case-workspace__dispositionRow">
              {dispositionOptions.map((d) => (
                <button
                  key={d}
                  className={selectedDisposition === d ? 'aml-btn aml-btn--primary' : 'aml-btn'}
                  onClick={() => setSelectedDisposition(d)}
                >
                  {DISPOSITION_LABELS[d]}
                </button>
              ))}
            </div>
            {isOverride && (
              <textarea
                className="case-workspace__overrideInput"
                placeholder="Required: reason for overriding the agent's recommendation"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={2}
              />
            )}
            <button className="aml-btn aml-btn--primary" disabled={!canSubmit || submitting} onClick={() => void handleSubmit()}>
              {submitting ? 'Submitting…' : 'Submit disposition'}
            </button>
          </div>
        )}

        <button className="aml-btn case-workspace__logToggle" onClick={() => setShowActivityLog((v) => !v)}>
          {showActivityLog ? 'Hide' : 'Show'} agent activity log
        </button>
        {showActivityLog && activityLog && (
          <div className="case-workspace__log">
            {activityLog.map((e) => (
              <div key={e.logId} className="case-workspace__logEntry">
                <strong>{e.agentName}</strong> v{e.agentVersion} · {e.modelProvider} · {e.latencyMs}ms
                {e.confidence !== null && ` · conf. ${e.confidence.toFixed(2)}`}
                <div className="case-workspace__logSources">sources: {e.dataSourcesQueried.join(', ') || 'none'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
