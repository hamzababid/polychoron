import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getConsistency,
  getDataLineage,
  getModelVersions,
  getSamplingOverview,
  recordSamplingReview,
} from '../api/client';
import type { ConsistencyResponse, DataLineageResponse, ModelVersionsResponse, SamplingOverview } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { useToast } from '../../../shell/ToastProvider';
import './model-governance.css';

const MLRO = 'aml_detection.mlro_compliance_head';
const MODEL_RISK_AUDIT = 'platform.model_risk_audit';
const EXTERNAL_EXAMINER = 'platform.external_examiner';

const LINEAGE_STATUS_LABEL: Record<string, string> = {
  observed: 'OBSERVED',
  stale: 'STALE',
  not_yet_observed: 'NOT YET OBSERVED',
};

/** specs/suites/bfsi/features/aml-detection/screens/09-model-governance-audit.md
 * Sampling & drift is "the most important panel on the screen" per the
 * spec, so it's built first and always visible to every role this
 * screen is gated to. Consistency / model-versions / data-lineage are
 * gated to mlro_compliance_head + model_risk_audit only —
 * external_examiner's RBAC is deliberately "sampling data only" (never
 * full case content), enforced server-side per route, and mirrored
 * here so the screen doesn't even attempt those calls for that role. */
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
  const [error, setError] = useState<string | null>(null);

  const [reviewingCaseId, setReviewingCaseId] = useState<string | null>(null);
  const [reviewerAgreed, setReviewerAgreed] = useState<'agree' | 'disagree' | ''>('');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadSampling = useCallback(() => {
    getSamplingOverview()
      .then(setSampling)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    loadSampling();
    if (canSeeFullAudit) {
      getConsistency().then(setConsistency).catch(() => undefined);
      getModelVersions().then(setModelVersions).catch(() => undefined);
      getDataLineage().then(setLineage).catch(() => undefined);
    }
  }, [loadSampling, canSeeFullAudit]);

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

  return (
    <div className="model-governance">
      <div className="model-governance__scroll">
        <div className="tile">
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Sampling &amp; drift — primary early-warning signal</span>
            <span className="model-governance__asOf">as of {new Date(sampling.asOf).toLocaleString()}</span>
          </div>
          <div className="tile-body">
            <div className="model-governance__summaryRow">
              <div>
                <div className="aml-label">Cleared dispositions (6mo)</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{sampling.totalClearedDispositions}</div>
              </div>
              <div>
                <div className="aml-label">Sampled</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{sampling.totalSampled}</div>
              </div>
              <div>
                <div className="aml-label">% of cleared sampled</div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{(sampling.percentOfClearedSampled * 100).toFixed(1)}%</div>
              </div>
            </div>

            <table className="table" style={{ marginTop: 12 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Sample size</th>
                  <th>Agreement rate</th>
                </tr>
              </thead>
              <tbody>
                {sampling.agreementRateTrend.map((p) => (
                  <tr key={p.month}>
                    <td>{p.month}</td>
                    <td>{p.sampleSize}</td>
                    <td>
                      {p.agreementRate === null ? (
                        <span className="model-governance__muted">no data</span>
                      ) : (
                        `${(p.agreementRate * 100).toFixed(0)}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="model-governance__panelHead">Pending review ({sampling.pendingReview.length})</div>
            {sampling.pendingReview.length === 0 ? (
              <div className="model-governance__muted">Nothing currently selected for sampling.</div>
            ) : (
              <ul className="model-governance__list">
                {sampling.pendingReview.map((p) => (
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
            )}

            {canWrite && reviewingCaseId && (
              <div className="model-governance__reviewForm">
                <div className="aml-label">Reviewing case {reviewingCaseId.slice(0, 8)}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button
                    className={`aml-btn${reviewerAgreed === 'agree' ? ' aml-btn--primary' : ''}`}
                    onClick={() => setReviewerAgreed('agree')}
                  >
                    Agree with disposition
                  </button>
                  <button
                    className={`aml-btn${reviewerAgreed === 'disagree' ? ' aml-btn--primary' : ''}`}
                    onClick={() => setReviewerAgreed('disagree')}
                  >
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

            <div className="model-governance__panelHead">Recent reviews</div>
            {sampling.recentReviews.length === 0 ? (
              <div className="model-governance__muted">No sampling reviews recorded yet.</div>
            ) : (
              <ul className="model-governance__list">
                {sampling.recentReviews.map((r) => (
                  <li key={r.reviewId}>
                    {r.caseId.slice(0, 8)} · {r.originalDisposition.replace('_', ' ')} ·{' '}
                    <span style={{ color: r.reviewerAgreed ? 'var(--color-accent-800)' : 'var(--color-alert)' }}>
                      {r.reviewerAgreed ? 'agreed' : 'disagreed'}
                    </span>{' '}
                    · {new Date(r.reviewedAt).toLocaleDateString()}
                    {r.reviewerNotes && ` — ${r.reviewerNotes}`}
                  </li>
                ))}
              </ul>
            )}
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
          <div className="tile">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head">
              <span className="aml-label">Consistency — STR conversion by typology &amp; branch</span>
              <span className="model-governance__asOf">as of {new Date(consistency.asOf).toLocaleString()}</span>
            </div>
            <div className="tile-body">
              {consistency.rows.length === 0 ? (
                <div className="model-governance__muted">No branch-attributed cases yet.</div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Typology</th>
                      <th>Branch</th>
                      <th>STR conversion</th>
                      <th>Sample size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consistency.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.typologyLabel}</td>
                        <td>{r.branchCode}</td>
                        <td>{(r.strConversionRate * 100).toFixed(0)}%</td>
                        <td>{r.sampleSize}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {canSeeFullAudit && modelVersions && (
          <div className="tile">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head">
              <span className="aml-label">Model versions in production</span>
              <span className="model-governance__asOf">as of {new Date(modelVersions.asOf).toLocaleString()}</span>
            </div>
            <div className="tile-body">
              {modelVersions.current.length === 0 ? (
                <div className="model-governance__muted">No agent invocations observed yet.</div>
              ) : (
                <>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Node</th>
                        <th>Version</th>
                        <th>Provider</th>
                        <th>Last invoked</th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelVersions.current.map((v) => (
                        <tr key={v.agentName}>
                          <td>{v.agentName}</td>
                          <td>{v.agentVersion}</td>
                          <td>{v.modelProvider}</td>
                          <td>{new Date(v.lastInvokedAt).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="model-governance__panelHead">Change history</div>
                  <ul className="model-governance__list">
                    {modelVersions.history.map((h, i) => (
                      <li key={i}>
                        {h.agentName} {h.agentVersion} — {h.invocationCount} invocations, {new Date(h.firstSeenAt).toLocaleDateString()} to{' '}
                        {new Date(h.lastSeenAt).toLocaleDateString()}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        )}

        {canSeeFullAudit && lineage && (
          <div className="tile">
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div className="tile-head">
              <span className="aml-label">Data lineage — upstream dependency status</span>
              <span className="model-governance__asOf">as of {new Date(lineage.asOf).toLocaleString()}</span>
            </div>
            <div className="tile-body">
              <ul className="model-governance__list">
                {lineage.entries.map((e) => (
                  <li key={e.system}>
                    <span
                      className={`tag ${e.status === 'observed' ? 'tag-solid' : 'tag-outline'}`}
                      style={{ color: e.status === 'stale' ? 'var(--color-alert)' : undefined, marginRight: 8 }}
                    >
                      {LINEAGE_STATUS_LABEL[e.status]}
                    </span>
                    {e.label} — {e.lastRefreshAt ? `last refresh ${new Date(e.lastRefreshAt).toLocaleString()}` : 'never observed'}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
