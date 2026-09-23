import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getConsistency,
  getDataLineage,
  getEvalRuns,
  getFairnessFlags,
  getGuardrailViolations,
  getModelVersions,
  getSamplingOverview,
  recordSamplingReview,
} from '../api/client';
import type {
  ConsistencyResponse,
  DataLineageResponse,
  EvalRunsResponse,
  FairnessFlagsResponse,
  GuardrailViolationsResponse,
  ModelVersionsResponse,
  SamplingAgreementTrendPoint,
  SamplingOverview,
} from '../api/types';
import { Pagination } from '../shared/Pagination';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { useToast } from '../../../shell/ToastProvider';
import './model-governance.css';

const MLRO = 'aml_detection.mlro_compliance_head';
const MODEL_RISK_AUDIT = 'platform.model_risk_audit';
const EXTERNAL_EXAMINER = 'platform.external_examiner';
const REVIEW_PAGE_SIZE = 10;

const LINEAGE_STATUS_LABEL: Record<string, string> = {
  observed: 'CURRENT',
  stale: 'STALE',
  not_yet_observed: 'NOT YET OBSERVED',
};

/** specs/suites/bfsi/features/aml-detection/screens/09-model-governance-audit.md
 * — restyled to match design-exports/bfsi/aml-detection/Model
 * Governance.dc.html's numbered-panel audit-report layout (the first
 * pass of this screen missed the design export entirely and improvised
 * generic tiles instead — this is the correction). The mockup's own
 * panel 05 ("Generate governance report" / export + report history) is
 * NOT built here: that's Reporting & MI's Phase 2 scope
 * (screens/10-reporting-mi.md, not yet started) — faking an export
 * button with no real artifact behind it would be exactly the kind of
 * silent no-op this project's constitution rules out elsewhere
 * (Screening Hub's freeze action, for the same reason, returns a real
 * 501 rather than pretending to work).
 *
 * Every stat below is real, computed from this tenant's actual data —
 * nothing here is the mockup's own placeholder branch names/officers/
 * narratives, which were fictional example content, not a data
 * contract to reproduce. */
export function ModelGovernanceScreen() {
  const { session } = useAuth();
  const base = useFeatureBasePath();
  const toast = useToast();
  const roleCodes = session?.user.roleCodes ?? [];
  const canWrite = roleCodes.includes(MLRO);
  const canSeeFullAudit = roleCodes.includes(MLRO) || roleCodes.includes(MODEL_RISK_AUDIT);
  const isExaminerOnly = roleCodes.includes(EXTERNAL_EXAMINER) && !canSeeFullAudit;

  const [sampling, setSampling] = useState<SamplingOverview | null>(null);
  const [consistency, setConsistency] = useState<ConsistencyResponse | null>(null);
  const [modelVersions, setModelVersions] = useState<ModelVersionsResponse | null>(null);
  const [lineage, setLineage] = useState<DataLineageResponse | null>(null);
  const [evalRuns, setEvalRuns] = useState<EvalRunsResponse | null>(null);
  const [fairnessFlags, setFairnessFlags] = useState<FairnessFlagsResponse | null>(null);
  const [guardrailViolations, setGuardrailViolations] = useState<GuardrailViolationsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(REVIEW_PAGE_SIZE);
  const [reviewedPage, setReviewedPage] = useState(1);
  const [reviewedPageSize, setReviewedPageSize] = useState(REVIEW_PAGE_SIZE);
  const [consistencyPage, setConsistencyPage] = useState(1);
  const [consistencyPageSize, setConsistencyPageSize] = useState(REVIEW_PAGE_SIZE);
  const [versionHistoryPage, setVersionHistoryPage] = useState(1);
  const [versionHistoryPageSize, setVersionHistoryPageSize] = useState(REVIEW_PAGE_SIZE);
  const [evalRunsPage, setEvalRunsPage] = useState(1);
  const [evalRunsPageSize, setEvalRunsPageSize] = useState(REVIEW_PAGE_SIZE);
  const [violationsPage, setViolationsPage] = useState(1);
  const [violationsPageSize, setViolationsPageSize] = useState(REVIEW_PAGE_SIZE);

  const [reviewingCaseId, setReviewingCaseId] = useState<string | null>(null);
  const [reviewerAgreed, setReviewerAgreed] = useState<'agree' | 'disagree' | ''>('');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadSampling = useCallback(() => {
    getSamplingOverview({ pendingPage, pendingPageSize, reviewedPage, reviewedPageSize })
      .then(setSampling)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [pendingPage, pendingPageSize, reviewedPage, reviewedPageSize]);

  useEffect(() => {
    loadSampling();
  }, [loadSampling]);

  useEffect(() => {
    if (canSeeFullAudit) {
      getConsistency({ page: consistencyPage, pageSize: consistencyPageSize })
        .then(setConsistency)
        .catch(() => undefined);
    }
  }, [canSeeFullAudit, consistencyPage, consistencyPageSize]);

  useEffect(() => {
    if (canSeeFullAudit) {
      getModelVersions({ page: versionHistoryPage, pageSize: versionHistoryPageSize })
        .then(setModelVersions)
        .catch(() => undefined);
    }
  }, [canSeeFullAudit, versionHistoryPage, versionHistoryPageSize]);

  useEffect(() => {
    if (canSeeFullAudit) {
      getDataLineage().then(setLineage).catch(() => undefined);
    }
    // canSeeFullAudit is derived from session, which doesn't change
    // within a mounted screen — fetched once, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (canSeeFullAudit) {
      getEvalRuns({ page: evalRunsPage, pageSize: evalRunsPageSize }).then(setEvalRuns).catch(() => undefined);
    }
  }, [canSeeFullAudit, evalRunsPage, evalRunsPageSize]);

  useEffect(() => {
    if (canSeeFullAudit) {
      getFairnessFlags({ pageSize: 20 }).then(setFairnessFlags).catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeFullAudit]);

  useEffect(() => {
    if (canSeeFullAudit) {
      getGuardrailViolations({ page: violationsPage, pageSize: violationsPageSize }).then(setGuardrailViolations).catch(() => undefined);
    }
  }, [canSeeFullAudit, violationsPage, violationsPageSize]);

  if (error) return <div className="aml-status aml-status--error">Could not load governance data: {error}</div>;
  if (!sampling) return <div className="aml-status">Loading model governance…</div>;

  const handleSubmitReview = async () => {
    if (!reviewingCaseId || reviewerAgreed === '' || !session) return;
    setSubmitting(true);
    try {
      await recordSamplingReview(reviewingCaseId, {
        reviewer_id: session.user.userId,
        reviewer_agreed: reviewerAgreed === 'agree',
        reviewer_notes: reviewerNotes.trim() || undefined,
      });
      toast.success('Sampling review recorded.');
      setReviewingCaseId(null);
      setReviewerAgreed('');
      setReviewerNotes('');
      loadSampling();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const trendPointsWithData = sampling.agreementRateTrend.filter((p) => p.agreementRate !== null);
  const driftLine =
    trendPointsWithData.length >= 2
      ? `Agreement moved ${(trendPointsWithData[0].agreementRate! * 100).toFixed(1)}% → ${(trendPointsWithData[trendPointsWithData.length - 1].agreementRate! * 100).toFixed(1)}% over the observed window.`
      : 'Not enough sampled months yet to assess drift.';

  return (
    <div className="model-governance">
      <div className="model-governance__reportHeader">
        <div className="model-governance__reportHeaderCell model-governance__reportHeaderTitle">
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>Model governance &amp; audit record</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>Agent-assisted alert disposition — every figure below is computed from live data, not a fixed extract</div>
        </div>
        <div className="model-governance__reportHeaderCell">
          <div className="aml-label">Observation window</div>
          <div style={{ fontSize: 13 }}>Trailing 6 months</div>
          <div className="model-governance__asOf">as of {new Date(sampling.asOf).toLocaleString()}</div>
        </div>
        {!isExaminerOnly && (
          <div className="model-governance__reportHeaderCell">
            <div className="aml-label">Sampling status</div>
            <div style={{ fontSize: 13 }}>
              {(sampling.percentOfClearedSampled * 100).toFixed(1)}% of cleared alerts sampled this window
            </div>
            <div className="model-governance__asOf">policy floor not yet configurable — tracked here for visibility</div>
          </div>
        )}
      </div>

      <div className="model-governance__scroll">
        {canSeeFullAudit && modelVersions && (
          <div className="tile model-governance__panel">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head model-governance__phead">
              <span className="model-governance__num">01</span>
              <h4 style={{ margin: 0 }}>Model version in production</h4>
              <span className="model-governance__asOf model-governance__pheadAsOf">as of {new Date(modelVersions.asOf).toLocaleString()}</span>
            </div>
            {modelVersions.current.length === 0 ? (
              <div className="tile-body model-governance__muted">No agent invocations observed yet.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.35fr', gap: 1, background: 'var(--color-divider)' }}>
                <div style={{ background: 'var(--color-bg)', padding: '13px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {modelVersions.current.map((v) => (
                    <div key={v.agentName} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 20, minWidth: 140 }}>{v.agentName}</span>
                      <span className="tag tag-solid" style={{ fontSize: 10 }}>
                        {v.agentVersion}
                      </span>
                      <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>
                        {v.modelProvider} · last invoked {new Date(v.lastInvokedAt).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--color-bg)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: '9px 14px', borderBottom: '1px solid var(--color-divider)' }}>
                    <h6 style={{ margin: 0 }}>Version &amp; change history</h6>
                    <span className="tag tag-neutral" style={{ fontSize: 10 }}>
                      {modelVersions.history.total} entries
                    </span>
                  </div>
                  {modelVersions.history.items.map((h, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '96px 1fr 110px',
                        gap: 11,
                        padding: '8px 14px',
                        borderBottom: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                      }}
                    >
                      <div>
                        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{h.agentName}</div>
                        <div className="model-governance__asOf">{h.agentVersion}</div>
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>
                        {new Date(h.firstSeenAt).toLocaleDateString()} – {new Date(h.lastSeenAt).toLocaleDateString()}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)', textAlign: 'right' }}>{h.invocationCount} invocations</div>
                    </div>
                  ))}
                  <Pagination
                    page={modelVersions.history.page}
                    pageSize={modelVersions.history.pageSize}
                    total={modelVersions.history.total}
                    onPageChange={setVersionHistoryPage}
                    onPageSizeChange={(size) => {
                      setVersionHistoryPageSize(size);
                      setVersionHistoryPage(1);
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="tile model-governance__panel model-governance__panel--primary">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head model-governance__phead">
            <span className="model-governance__num">{canSeeFullAudit ? '02' : '01'}</span>
            <h4 style={{ margin: 0 }}>Sampling &amp; drift check — primary control</h4>
            <span className="model-governance__asOf model-governance__pheadAsOf">as of {new Date(sampling.asOf).toLocaleString()}</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 1, background: 'var(--color-divider)' }}>
            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              <div className="aml-label">Sampled (6mo)</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 3 }}>
                <span style={{ fontFamily: 'var(--font-heading)', fontSize: 28 }}>{sampling.totalSampled}</span>
                <span style={{ fontSize: 12, color: 'var(--color-neutral-700)' }}>of {sampling.totalClearedDispositions}<br />cleared</span>
              </div>
              <div className="model-governance__asOf">{(sampling.percentOfClearedSampled * 100).toFixed(1)}% of cleared alerts</div>
            </div>
            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              <div className="aml-label">Reviewer agreed</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 28, marginTop: 3 }}>
                {sampling.recentReviews.total > 0 ? sampling.recentReviews.items.filter((r) => r.reviewerAgreed).length : '—'}
              </div>
              <div className="model-governance__asOf">this page of reviews</div>
            </div>
            <div
              style={{
                background: 'color-mix(in srgb, var(--color-alert) 8%, transparent)',
                padding: '12px 14px',
                boxShadow: 'inset 0 0 0 2px var(--color-alert)',
              }}
            >
              <div className="aml-label" style={{ color: 'var(--color-alert)' }}>
                Reviewer disagreed
              </div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 28, marginTop: 3, color: 'var(--color-alert)' }}>
                {sampling.recentReviews.items.filter((r) => !r.reviewerAgreed).length}
              </div>
              <div className="model-governance__asOf" style={{ color: 'var(--color-alert)' }}>
                this page of reviews
              </div>
            </div>
            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              <div className="aml-label">Drift assessment</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, marginTop: 4, color: 'var(--color-neutral-800)' }}>{driftLine}</div>
            </div>
          </div>

          <div style={{ padding: '12px 14px', borderTop: '1px solid var(--color-divider)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 8 }}>
              <span className="aml-label">Agreement rate — trailing six months</span>
            </div>
            <AgreementTrendChart points={sampling.agreementRateTrend} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: 'var(--color-divider)', borderTop: '1px solid var(--color-divider)' }}>
            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              <div className="model-governance__panelHead">Pending review ({sampling.pendingReview.total})</div>
              {sampling.pendingReview.items.length === 0 ? (
                <div className="model-governance__muted">Nothing currently selected for sampling.</div>
              ) : (
                <>
                  <ul className="model-governance__list">
                    {sampling.pendingReview.items.map((p) => (
                      <li key={p.caseId}>
                        <Link to={`${base}/cases/${p.caseId}`}>{p.caseId.slice(0, 8)}</Link> · {p.dispositionType.replace('_', ' ')} ·{' '}
                        {new Date(p.dispositionedAt).toLocaleDateString()}
                        {canWrite && (
                          <button className="aml-btn" style={{ marginLeft: 10 }} onClick={() => setReviewingCaseId(p.caseId)}>
                            Review
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={sampling.pendingReview.page}
                    pageSize={sampling.pendingReview.pageSize}
                    total={sampling.pendingReview.total}
                    onPageChange={setPendingPage}
                    onPageSizeChange={(size) => {
                      setPendingPageSize(size);
                      setPendingPage(1);
                    }}
                  />
                </>
              )}

              {canWrite && reviewingCaseId && (
                <div className="model-governance__reviewForm">
                  <div className="aml-label">Reviewing case {reviewingCaseId.slice(0, 8)}</div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button className={`aml-btn${reviewerAgreed === 'agree' ? ' aml-btn--primary' : ''}`} onClick={() => setReviewerAgreed('agree')}>
                      Agree with disposition
                    </button>
                    <button className={`aml-btn${reviewerAgreed === 'disagree' ? ' aml-btn--primary' : ''}`} onClick={() => setReviewerAgreed('disagree')}>
                      Disagree with disposition
                    </button>
                  </div>
                  <textarea
                    className="input"
                    placeholder="Reviewer notes (optional)"
                    value={reviewerNotes}
                    onChange={(e) => setReviewerNotes(e.target.value)}
                    rows={2}
                    style={{ marginTop: 8 }}
                  />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                    <button className="aml-btn aml-btn--primary" disabled={reviewerAgreed === '' || submitting} onClick={() => void handleSubmitReview()}>
                      {submitting ? 'Submitting…' : 'Submit review'}
                    </button>
                    <button className="aml-btn" onClick={() => setReviewingCaseId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div style={{ background: 'var(--color-bg)', padding: '12px 14px' }}>
              <div className="model-governance__panelHead">Recent reviews ({sampling.recentReviews.total})</div>
              {sampling.recentReviews.items.length === 0 ? (
                <div className="model-governance__muted">No sampling reviews recorded yet.</div>
              ) : (
                <>
                  <ul className="model-governance__list">
                    {sampling.recentReviews.items.map((r) => (
                      <li key={r.reviewId} style={{ borderLeft: `3px solid ${r.reviewerAgreed ? 'var(--color-accent-700)' : 'var(--color-alert)'}`, paddingLeft: 8 }}>
                        <Link to={`${base}/cases/${r.caseId}`}>{r.caseId.slice(0, 8)}</Link> · {r.originalDisposition.replace('_', ' ')} ·{' '}
                        <span style={{ color: r.reviewerAgreed ? 'var(--color-accent-800)' : 'var(--color-alert)' }}>{r.reviewerAgreed ? 'agreed' : 'disagreed'}</span> ·{' '}
                        {new Date(r.reviewedAt).toLocaleDateString()}
                        {r.reviewerNotes && ` — ${r.reviewerNotes}`}
                      </li>
                    ))}
                  </ul>
                  <Pagination
                    page={sampling.recentReviews.page}
                    pageSize={sampling.recentReviews.pageSize}
                    total={sampling.recentReviews.total}
                    onPageChange={setReviewedPage}
                    onPageSizeChange={(size) => {
                      setReviewedPageSize(size);
                      setReviewedPage(1);
                    }}
                  />
                </>
              )}
            </div>
          </div>
        </div>

        {isExaminerOnly && (
          <div className="tile" style={{ padding: 14 }}>
            <span className="model-governance__muted">
              Consistency, model versions, and data lineage aren't shown to this role — external examiner access is sampling data
              only, per the screen's access rules.
            </span>
          </div>
        )}

        {canSeeFullAudit && consistency && (
          <div className="tile model-governance__panel">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head model-governance__phead">
              <span className="model-governance__num">03</span>
              <h4 style={{ margin: 0 }}>Consistency check — like cases, like outcomes</h4>
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>STR conversion by typology, broken out by branch</span>
              <span className="model-governance__asOf model-governance__pheadAsOf">as of {new Date(consistency.asOf).toLocaleString()}</span>
            </div>
            {consistency.rows.items.length === 0 ? (
              <div className="tile-body model-governance__muted">No branch-attributed cases yet.</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '150px 90px 1fr 90px 130px', background: 'var(--color-neutral-100)', borderBottom: '1px solid var(--color-text)' }}>
                  <div className="model-governance__ahd">Typology / branch</div>
                  <div className="model-governance__ahd" style={{ textAlign: 'right' }}>
                    Alerts
                  </div>
                  <div className="model-governance__ahd">STR conversion</div>
                  <div className="model-governance__ahd" style={{ textAlign: 'right' }}>
                    vs. mean
                  </div>
                  <div className="model-governance__ahd">Assessment</div>
                </div>
                {consistency.rows.items.map((r, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '150px 90px 1fr 90px 130px',
                      alignItems: 'center',
                      borderBottom: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                    }}
                  >
                    <div style={{ padding: '8px 11px', fontSize: 13 }}>
                      {r.typologyLabel}
                      <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{r.branchCode}</div>
                    </div>
                    <div style={{ padding: '8px 11px', textAlign: 'right', fontSize: 13 }}>{r.sampleSize}</div>
                    <div style={{ padding: '8px 11px', display: 'flex', alignItems: 'center', gap: 9 }}>
                      <span style={{ fontFamily: 'var(--font-heading)', fontSize: 15, width: 50 }}>{(r.strConversionRate * 100).toFixed(1)}%</span>
                      <ConsistencyBar rate={r.strConversionRate} maxRate={Math.max(0.05, ...consistency.rows.items.map((x) => x.strConversionRate)) * 1.15} />
                    </div>
                    <div style={{ padding: '8px 11px', textAlign: 'right', fontSize: 12, color: r.withinTolerance ? 'var(--color-neutral-700)' : 'var(--color-alert)' }}>
                      {r.deviationFromTypologyMean >= 0 ? '+' : '−'}
                      {Math.abs(r.deviationFromTypologyMean).toFixed(1)} pts
                    </div>
                    <div style={{ padding: '8px 11px', fontSize: 11.5, color: r.withinTolerance ? 'var(--color-neutral-700)' : 'var(--color-alert)' }}>
                      {r.withinTolerance ? 'within tolerance' : 'elevated'}
                    </div>
                  </div>
                ))}
                <div style={{ padding: '8px 11px', fontSize: 11.5, color: 'var(--color-neutral-700)' }}>{consistency.toleranceLabel}</div>
                <Pagination
                  page={consistency.rows.page}
                  pageSize={consistency.rows.pageSize}
                  total={consistency.rows.total}
                  onPageChange={setConsistencyPage}
                  onPageSizeChange={(size) => {
                    setConsistencyPageSize(size);
                    setConsistencyPage(1);
                  }}
                />
              </>
            )}
          </div>
        )}

        {canSeeFullAudit && lineage && (
          <div className="tile model-governance__panel">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head model-governance__phead">
              <span className="model-governance__num">04</span>
              <h4 style={{ margin: 0 }}>Data lineage &amp; feed status</h4>
              <span style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>Every input the agent reads, and when it last refreshed</span>
              <span className="model-governance__asOf model-governance__pheadAsOf">as of {new Date(lineage.asOf).toLocaleString()}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '210px 1fr 190px 170px 150px', background: 'var(--color-neutral-100)', borderBottom: '1px solid var(--color-text)' }}>
              <div className="model-governance__ahd">Source system</div>
              <div className="model-governance__ahd">What the agent takes from it</div>
              <div className="model-governance__ahd">Last refresh</div>
              <div className="model-governance__ahd">Cadence</div>
              <div className="model-governance__ahd">Status</div>
            </div>
            {lineage.entries.map((e) => {
              const color = e.status === 'observed' ? 'var(--color-accent-700)' : e.status === 'stale' ? 'var(--color-alert)' : 'var(--color-neutral-500)';
              return (
                <div
                  key={e.system}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '210px 1fr 190px 170px 150px',
                    alignItems: 'center',
                    borderBottom: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                    background: e.status === 'stale' ? 'color-mix(in srgb, var(--color-alert) 6%, transparent)' : 'var(--color-bg)',
                  }}
                >
                  <div style={{ padding: '9px 11px', borderLeft: `4px solid ${color}` }}>
                    <div style={{ fontSize: 13 }}>{e.label}</div>
                  </div>
                  <div style={{ padding: '9px 11px', fontSize: 12, color: 'var(--color-neutral-800)', lineHeight: 1.4 }}>{e.usedFor}</div>
                  <div style={{ padding: '9px 11px', fontSize: 12.5 }}>{e.lastRefreshAt ? new Date(e.lastRefreshAt).toLocaleString() : '—'}</div>
                  <div style={{ padding: '9px 11px', fontSize: 12, color: 'var(--color-neutral-700)' }}>{e.cadence}</div>
                  <div style={{ padding: '9px 11px' }}>
                    <span
                      style={{
                        display: 'inline-grid',
                        placeItems: 'center',
                        height: 20,
                        padding: '0 8px',
                        fontFamily: 'var(--font-heading)',
                        fontSize: 10.5,
                        letterSpacing: '.08em',
                        border: `1px solid ${color}`,
                        color,
                      }}
                    >
                      {LINEAGE_STATUS_LABEL[e.status]}
                    </span>
                  </div>
                </div>
              );
            })}
            {lineage.entries.some((e) => e.status === 'stale') && (
              <div
                style={{
                  padding: '9px 14px',
                  fontSize: 11.5,
                  color: 'var(--color-alert)',
                  background: 'color-mix(in srgb, var(--color-alert) 8%, transparent)',
                  borderTop: '1px solid var(--color-divider)',
                }}
              >
                One or more feeds are past their expected cadence — see STALE rows above.
              </div>
            )}
          </div>
        )}

        {canSeeFullAudit && (evalRuns || fairnessFlags || guardrailViolations) && (
          <div className="tile model-governance__panel">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head model-governance__phead">
              <span className="model-governance__num">05</span>
              <h4 style={{ margin: 0 }}>Evals &amp; guardrails</h4>
            </div>

            {evalRuns && (
              <div style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, padding: '9px 14px' }}>
                  <h6 style={{ margin: 0 }}>Golden-dataset regression history</h6>
                  {evalRuns.latestStatus && (
                    <span
                      className="tag tag-solid"
                      style={{
                        fontSize: 10,
                        background: evalRuns.latestStatus === 'passed' ? 'var(--color-accent-700)' : 'var(--color-alert)',
                      }}
                    >
                      LATEST: {evalRuns.latestStatus.toUpperCase()}
                    </span>
                  )}
                </div>
                {evalRuns.rows.items.length === 0 ? (
                  <div className="tile-body model-governance__muted">No regression runs yet.</div>
                ) : (
                  <>
                    {evalRuns.rows.items.map((r) => (
                      <div
                        key={r.runId}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '130px 1fr 120px 150px',
                          alignItems: 'center',
                          padding: '7px 14px',
                          borderTop: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                          fontSize: 12.5,
                        }}
                      >
                        <div>{r.agentVersionUnderTest}</div>
                        <div style={{ color: 'var(--color-neutral-700)' }}>{new Date(r.startedAt).toLocaleString()}</div>
                        <div>
                          {r.passed}/{r.totalCases} passed
                        </div>
                        <div style={{ color: r.status === 'passed' ? 'var(--color-accent-800)' : 'var(--color-alert)' }}>{r.status}</div>
                      </div>
                    ))}
                    <Pagination
                      page={evalRuns.rows.page}
                      pageSize={evalRuns.rows.pageSize}
                      total={evalRuns.rows.total}
                      onPageChange={setEvalRunsPage}
                      onPageSizeChange={(size) => {
                        setEvalRunsPageSize(size);
                        setEvalRunsPage(1);
                      }}
                    />
                  </>
                )}
              </div>
            )}

            {fairnessFlags && (
              <div style={{ borderBottom: '1px solid var(--color-divider)' }}>
                <div style={{ padding: '9px 14px' }}>
                  <h6 style={{ margin: 0 }}>Fairness flags — for human review only, never an automatic action</h6>
                </div>
                {fairnessFlags.rows.items.length === 0 ? (
                  <div className="tile-body model-governance__muted">No flagged segments in the most recent computation.</div>
                ) : (
                  fairnessFlags.rows.items.map((f) => (
                    <div
                      key={f.snapshotId}
                      style={{
                        padding: '7px 14px',
                        borderTop: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                        fontSize: 12.5,
                        color: 'var(--color-alert)',
                      }}
                    >
                      {f.segmentDimension} = {f.segmentValue}: {(f.strRecommendationRate * 100).toFixed(1)}% STR rate (
                      {f.baselineDeviation.toFixed(2)}× baseline)
                    </div>
                  ))
                )}
              </div>
            )}

            {guardrailViolations && (
              <div>
                <div style={{ padding: '9px 14px' }}>
                  <h6 style={{ margin: 0 }}>Guardrail violations (G1 prompt-injection, G3 citation-fabrication)</h6>
                </div>
                {guardrailViolations.rows.items.length === 0 ? (
                  <div className="tile-body model-governance__muted">No guardrail violations recorded.</div>
                ) : (
                  <>
                    {guardrailViolations.rows.items.map((v) => (
                      <div
                        key={v.violationId}
                        style={{
                          padding: '7px 14px',
                          borderTop: '1px solid color-mix(in srgb, var(--color-text) 8%, transparent)',
                          fontSize: 12,
                        }}
                      >
                        <span
                          className="tag tag-neutral"
                          style={{ fontSize: 9.5, marginRight: 6, color: v.severity === 'blocked' || v.severity === 'escalated' ? 'var(--color-alert)' : undefined }}
                        >
                          {v.severity.toUpperCase()}
                        </span>
                        <Link to={`${base}/cases/${v.externalCaseRef}`}>{v.externalCaseRef.slice(0, 8)}</Link>
                        {' · '}
                        {v.guardrailType} ({v.nodeName}) · {new Date(v.detectedAt).toLocaleString()}
                        <div style={{ color: 'var(--color-neutral-700)', marginTop: 2 }}>{v.details}</div>
                      </div>
                    ))}
                    <Pagination
                      page={guardrailViolations.rows.page}
                      pageSize={guardrailViolations.rows.pageSize}
                      total={guardrailViolations.rows.total}
                      onPageChange={setViolationsPage}
                      onPageSizeChange={(size) => {
                        setViolationsPageSize(size);
                        setViolationsPage(1);
                      }}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ConsistencyBar({ rate, maxRate }: { rate: number; maxRate: number }) {
  const widthPct = Math.min(100, (rate / maxRate) * 100);
  return (
    <span style={{ flex: 1, height: 9, background: 'var(--color-neutral-200)', position: 'relative', maxWidth: 160 }}>
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${widthPct}%`, background: 'var(--color-accent-600)' }} />
    </span>
  );
}

/** Hand-coded SVG, same conventions as DashboardScreen's TrendChart
 * (not reused directly — that one is a bar+line combo chart shaped
 * for volume/conversion; this is a single line with nullable points
 * and a fixed investigation threshold, different enough to not force
 * one shared abstraction over both). */
function AgreementTrendChart({ points }: { points: SamplingAgreementTrendPoint[] }) {
  const W = 560;
  const H = 150;
  const padL = 30;
  const padR = 10;
  const padT = 16;
  const padB = 20;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const slotW = plotW / points.length;
  const THRESHOLD = 0.9;
  const MIN = 0.7;

  const scaleY = (v: number) => padT + plotH * (1 - Math.max(0, Math.min(1, (v - MIN) / (1 - MIN))));

  const withData = points.map((p, i) => (p.agreementRate === null ? null : { x: padL + i * slotW + slotW / 2, y: scaleY(p.agreementRate), p }));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', fontFamily: 'var(--font-body)' }}>
      <g stroke="var(--color-divider)">
        <line x1={padL} y1={padT + plotH} x2={W - padR} y2={padT + plotH} />
        <line x1={padL} y1={padT} x2={W - padR} y2={padT} strokeDasharray="3 4" />
      </g>
      <g fontSize="9" fill="var(--color-neutral-600)" textAnchor="end">
        <text x={padL - 4} y={padT + plotH + 3}>
          {(MIN * 100).toFixed(0)}%
        </text>
        <text x={padL - 4} y={padT + 4}>
          100%
        </text>
      </g>
      <line x1={padL} y1={scaleY(THRESHOLD)} x2={W - padR} y2={scaleY(THRESHOLD)} stroke="var(--color-alert)" strokeWidth="1.5" strokeDasharray="7 4" />
      <text x={W - padR} y={scaleY(THRESHOLD) - 4} fontSize="9" fill="var(--color-alert)" textAnchor="end">
        INVESTIGATION THRESHOLD {(THRESHOLD * 100).toFixed(0)}%
      </text>

      <polyline
        points={withData
          .filter((pt) => pt !== null)
          .map((pt) => `${pt.x},${pt.y}`)
          .join(' ')}
        fill="none"
        stroke="var(--color-accent-800)"
        strokeWidth="2.5"
      />
      {withData.map(
        (pt, i) =>
          pt && (
            <g key={i}>
              <rect x={pt.x - 4} y={pt.y - 4} width={8} height={8} fill="var(--color-bg)" stroke="var(--color-accent-800)" strokeWidth="2" />
              <text x={pt.x} y={pt.y - 9} fontSize="10.5" fill="var(--color-text)" textAnchor="middle" fontFamily="var(--font-heading)">
                {(pt.p.agreementRate! * 100).toFixed(1)}
              </text>
            </g>
          ),
      )}

      <g fontSize="10.5" fill="var(--color-neutral-700)" textAnchor="middle">
        {points.map((p, i) => (
          <text key={p.month} x={padL + i * slotW + slotW / 2} y={H - 4}>
            {monthShortLabel(p.month)}
          </text>
        ))}
      </g>
    </svg>
  );
}

function monthShortLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}
