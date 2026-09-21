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
  clear: 'Clear',
  enhanced_monitoring: 'Enhanced monitoring',
  escalate_senior: 'Escalate to senior officer',
  file_str: 'File STR',
  file_ctr: 'File CTR',
};

const DISPOSITION_DESCRIPTIONS: Record<DispositionType, string> = {
  clear: 'No suspicion. Alert closed, no filing.',
  enhanced_monitoring: '90-day watch, lowered thresholds.',
  escalate_senior: 'Review by a senior officer before filing.',
  file_str: 'Suspicious Transaction Report to FMU.',
  file_ctr: 'Currency report only, no suspicion stated.',
};

const FILING_ROLES = ['aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head'];

/** specs/suites/bfsi/features/aml-detection/screens/03-case-workspace.md
 * — highest-usage screen, restyled to match
 * design-exports/.../Case Workspace.dc.html's evidence / reasoning
 * split. The agent's draft_narrative is rendered read-only (distinctly
 * styled via .ai-band/.ai-hatch, never editable in place) since
 * there's no backend endpoint to persist an edit to it from this
 * screen — the editable narrative that does persist is Filing
 * Console's final_narrative. */
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

  const alert = caseDetail.alert;

  return (
    <div className="case-workspace">
      <div className="case-workspace__identity">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{alert?.source_alert_id ?? caseId.slice(0, 8)}</span>
            <span className="tag tag-outline">{caseDetail.status.replace('_', ' ').toUpperCase()}</span>
          </div>
          {caseDetail.evidence && (
            <div style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>
              {caseDetail.evidence.kyc.customer_name} · A/C {alert?.account_ids?.join(', ') ?? '—'}
            </div>
          )}
        </div>
        {caseDetail.assessment && (
          <div className="case-workspace__riskMeter">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="aml-label">Composite risk score</span>
              <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>
                {caseDetail.assessment.risk_score}
                <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>/100</span>
              </span>
            </div>
            <div className="case-workspace__riskBar">
              <span style={{ width: `${caseDetail.assessment.risk_score}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="case-workspace__panels">
        <div className="case-workspace__left">
          <div className="case-workspace__panelHead">
            <h6 style={{ margin: 0 }}>Evidence</h6>
            <span className="aml-tag" style={{ fontSize: 10 }}>
              AI-ASSEMBLED · READ-ONLY
            </span>
          </div>
          <div className="case-workspace__scroll">
            {caseDetail.evidence === null && caseDetail.status !== 'open' && (
              <div className="case-workspace__warning">Evidence is unavailable for this case — showing what's known.</div>
            )}

            {caseDetail.evidence ? (
              <>
                <div className="tile">
                  <i className="corner tl" />
                  <i className="corner tr" />
                  <i className="corner bl" />
                  <i className="corner br" />
                  <div className="tile-head">
                    <span className="aml-label">Customer summary</span>
                  </div>
                  <div className="tile-body case-workspace__kyc">
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

                <div className="tile">
                  <i className="corner tl" />
                  <i className="corner tr" />
                  <i className="corner bl" />
                  <i className="corner br" />
                  <div className="tile-head">
                    <span className="aml-label">Transaction timeline</span>
                  </div>
                  <div className="tile-body">
                    <table className="table">
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
                </div>

                <div className="tile">
                  <i className="corner tl" />
                  <i className="corner tr" />
                  <i className="corner bl" />
                  <i className="corner br" />
                  <div className="tile-head">
                    <span className="aml-label">Linked entities</span>
                  </div>
                  <div className="tile-body">
                    <LinkedEntityGraph centerLabel={caseDetail.evidence.kyc.customer_name} entities={caseDetail.evidence.linked_entities} />
                  </div>
                </div>

                <div className="tile">
                  <i className="corner tl" />
                  <i className="corner tr" />
                  <i className="corner bl" />
                  <i className="corner br" />
                  <div className="tile-head">
                    <span className="aml-label">Prior cases</span>
                  </div>
                  <div className="tile-body">
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
                </div>

                <div className="tile">
                  <i className="corner tl" />
                  <i className="corner tr" />
                  <i className="corner bl" />
                  <i className="corner br" />
                  <div className="tile-head">
                    <span className="aml-label">Sanctions · PEP · adverse media</span>
                  </div>
                  <div className="tile-body">
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
                </div>
              </>
            ) : (
              <div className="tile aml-status">Evidence is still being assembled by the agent chain…</div>
            )}
          </div>
        </div>

        <div className="case-workspace__right">
          <div className="case-workspace__panelHead">
            <h6 style={{ margin: 0 }}>Reasoning + decision</h6>
            <div className="case-workspace__legend">
              <span>
                <span className="case-workspace__legendSwatch ai-hatch" />
                AI-DRAFTED
              </span>
              <span>
                <span className="case-workspace__legendSwatch case-workspace__legendSwatch--officer" />
                OFFICER
              </span>
            </div>
          </div>
          <div className="case-workspace__scroll">
            {caseDetail.typologyMatch && (
              <div className="aml-source-ai">
                <div className="ai-band">
                  AI-DRAFTED · NOT AN OFFICER FINDING
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <div className="aml-label" style={{ color: 'var(--color-accent-800)' }}>
                    Matched typology
                  </div>
                  <div className="case-workspace__typologyLabel">{caseDetail.typologyMatch.typology_label}</div>
                  <div className="case-workspace__conf">
                    Model confidence <strong>{(caseDetail.typologyMatch.confidence * 100).toFixed(0)}%</strong>
                  </div>
                  <p>{caseDetail.typologyMatch.plain_language_rationale}</p>
                  <ul className="case-workspace__list">
                    {caseDetail.typologyMatch.matched_indicators.map((ind) => (
                      <li key={ind.indicator_code}>
                        <strong>{ind.indicator_description}</strong> — {ind.contributing_evidence}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {caseDetail.assessment && (
              <div className="aml-source-ai" style={{ marginTop: 10 }}>
                <div className="ai-band">
                  AI-DRAFTED NARRATIVE · READ-ONLY (risk {caseDetail.assessment.risk_score}/100)
                </div>
                <div style={{ padding: '12px 14px' }}>
                  <p style={{ margin: 0 }}>{caseDetail.assessment.draft_narrative}</p>
                  <div className="case-workspace__conf" style={{ marginTop: 8 }}>
                    Recommendation: <strong>{caseDetail.assessment.recommendation.replace('_', ' ')}</strong> (confidence{' '}
                    {(caseDetail.assessment.recommendation_confidence * 100).toFixed(0)}%) — advisory only, the officer's disposition governs.
                  </div>
                </div>
              </div>
            )}

            {isDisposed ? (
              <div className="aml-source-human" style={{ marginTop: 10 }}>
                <div className="officer-band">OFFICER DISPOSITION</div>
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{DISPOSITION_LABELS[caseDetail.disposition!.disposition_type]}</div>
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
              </div>
            ) : (
              <div className="case-workspace__dispositionPanel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 9 }}>
                  <h6 style={{ margin: 0 }}>Disposition</h6>
                  <span style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>One deliberate selection. Nothing is submitted until you confirm.</span>
                </div>
                <div className="case-workspace__dispositionGrid">
                  {dispositionOptions.map((d) => (
                    <div
                      key={d}
                      className={`case-workspace__dispositionCard${selectedDisposition === d ? ' case-workspace__dispositionCard--selected' : ''}`}
                      onClick={() => setSelectedDisposition(d)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>{DISPOSITION_LABELS[d]}</span>
                        {recommendedDisposition === d && (
                          <span className="tag tag-solid" style={{ fontSize: 9 }}>
                            AGENT REC.
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--color-neutral-700)', marginTop: 3 }}>{DISPOSITION_DESCRIPTIONS[d]}</div>
                    </div>
                  ))}
                </div>

                <textarea
                  className="input"
                  placeholder="Officer notes (separate from the agent narrative above, never overwritten by it)"
                  value={officerNotes}
                  onChange={(e) => setOfficerNotes(e.target.value)}
                  rows={3}
                  style={{ marginTop: 10 }}
                />

                {isOverride && (
                  <div className="case-workspace__overridePanel">
                    <div className="aml-label" style={{ color: 'var(--color-text)' }}>
                      Reason for override · required
                    </div>
                    <textarea
                      className="input"
                      placeholder="State why the agent's reading is not adopted — retained in the audit log."
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      rows={2}
                      style={{ marginTop: 6 }}
                    />
                  </div>
                )}

                <button className="aml-btn aml-btn--primary" disabled={!canSubmit || submitting} onClick={() => void handleSubmit()} style={{ marginTop: 10 }}>
                  {submitting ? 'Submitting…' : selectedDisposition ? `Confirm — ${DISPOSITION_LABELS[selectedDisposition]}` : 'Confirm disposition'}
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
      </div>
    </div>
  );
}
