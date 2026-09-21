import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addFollowup, getFilingDetail, listFilings, simulateAcknowledgment } from '../api/client';
import type { FilingDetail, FilingSummary } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { ApiError } from '../../../auth/apiClient';
import { useToast } from '../../../shell/ToastProvider';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './goaml-tracker.css';

const STEPS = ['submitted', 'acknowledged', 'feedback_received'] as const;
const STEP_LABELS = ['Submitted', 'Acknowledged by FMU', 'Feedback received'];

function stepIndex(status: FilingSummary['submissionStatus']): number {
  const i = STEPS.indexOf(status as (typeof STEPS)[number]);
  return i === -1 ? 0 : i;
}

/** specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md
 * restyled to match design-exports/.../goAML Tracker.dc.html's
 * portfolio-strip + dense-list + stepper-detail language. This
 * endpoint is restricted to senior_officer_l2/mlro_compliance_head
 * server-side (goaml-tracker.controller.ts); the sidebar nav link is
 * hidden for anyone else (shell/featureNav.ts), so hitting a 403 here
 * means a stale link/bookmark or a direct URL, not the normal path —
 * shown as a proper access-restricted state, not a raw error. */
export function GoamlTrackerScreen() {
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const { session } = useAuth();
  const toast = useToast();
  const [filings, setFilings] = useState<FilingSummary[] | null>(null);
  const [loadError, setLoadError] = useState<ApiError | Error | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FilingDetail | null>(null);
  const [followupNote, setFollowupNote] = useState('');
  const [acking, setAcking] = useState(false);

  const loadList = useCallback(() => {
    listFilings({ pageSize: 50 })
      .then((res) => {
        setFilings(res.items);
        setSelectedId((current) => current ?? res.items[0]?.filingId ?? null);
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err : new Error(String(err))));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    getFilingDetail(selectedId)
      .then(setDetail)
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const handleAcknowledge = async () => {
    if (!selectedId) return;
    setAcking(true);
    try {
      await simulateAcknowledgment(selectedId);
      loadList();
      const updated = await getFilingDetail(selectedId);
      setDetail(updated);
      toast.success('Acknowledgment simulated.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setAcking(false);
    }
  };

  const handleAddFollowup = async () => {
    if (!selectedId || !followupNote.trim() || !session) return;
    try {
      await addFollowup(selectedId, followupNote, session.user.userId);
      setFollowupNote('');
      const updated = await getFilingDetail(selectedId);
      setDetail(updated);
      toast.success('Follow-up note added.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  const counts = useMemo(() => {
    if (!filings) return null;
    return {
      total: filings.length,
      awaiting: filings.filter((f) => f.submissionStatus === 'submitted').length,
      acknowledged: filings.filter((f) => f.submissionStatus === 'acknowledged' || f.submissionStatus === 'feedback_received').length,
      retentionDue: filings.filter((f) => f.retentionReviewDue).length,
    };
  }, [filings]);

  if (loadError) {
    const isForbidden = loadError instanceof ApiError && loadError.status === 403;
    return (
      <div className="tile goaml-tracker__accessState">
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div className="tile-body">
          {isForbidden ? (
            <>
              <div className="goaml-tracker__accessTitle">You don't have access to the goAML Tracker</div>
              <p className="goaml-tracker__accessBody">
                Viewing filings requires a Senior Compliance Officer or MLRO / Compliance Head role. If you believe this is wrong,
                check with your MLRO.
              </p>
              <button className="aml-btn" onClick={() => navigate(`${base}/dashboard`)}>
                ← Back to Dashboard
              </button>
            </>
          ) : (
            <>
              <div className="goaml-tracker__accessTitle">Could not load filings</div>
              <p className="goaml-tracker__accessBody">{loadError.message}</p>
              <button
                className="aml-btn"
                onClick={() => {
                  setLoadError(null);
                  loadList();
                }}
              >
                Try again
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="goaml-tracker">
      {counts && (
        <div className="stripbar">
          <div className="stripbar__cell" style={{ minWidth: 170 }}>
            <div className="aml-label">Filings on record</div>
            <div className="stripbar__big">{counts.total}</div>
          </div>
          <div className="stripbar__cell" style={{ display: 'flex', gap: 22 }}>
            <div>
              <div className="aml-label">Awaiting acknowledgement</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{counts.awaiting}</div>
            </div>
            <div>
              <div className="aml-label">Acknowledged</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{counts.acknowledged}</div>
            </div>
            <div>
              <div className="aml-label" style={{ color: counts.retentionDue > 0 ? 'var(--color-accent-700)' : undefined }}>
                Retention review due
              </div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18, color: counts.retentionDue > 0 ? 'var(--color-accent-700)' : undefined }}>
                {counts.retentionDue}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="goaml-tracker__body">
        <div className="goaml-tracker__list">
          <div className="trow trow--head">
            <div className="tcell">Type</div>
            <div className="tcell">Case</div>
            <div className="tcell">Status</div>
            <div className="tcell">goAML reference</div>
            <div className="tcell" style={{ textAlign: 'center' }}>
              Ret.
            </div>
          </div>
          <div className="goaml-tracker__listScroll">
            {filings === null ? (
              <div className="aml-status">Loading…</div>
            ) : filings.length === 0 ? (
              <div className="aml-status">No filings submitted yet.</div>
            ) : (
              filings.map((f) => (
                <div
                  key={f.filingId}
                  className={`trow ${selectedId === f.filingId ? 'trow--selected' : ''}`}
                  onClick={() => setSelectedId(f.filingId)}
                >
                  <div className="tcell">
                    <span className="aml-tag">{f.reportType.toUpperCase()}</span>
                  </div>
                  <div className="tcell" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                    {f.caseId.slice(0, 8)}
                  </div>
                  <div className="tcell">
                    <div className="goaml-tracker__miniStepper">
                      {STEPS.map((s, i) => (
                        <span key={s} className={i <= stepIndex(f.submissionStatus) ? 'goaml-tracker__miniDot--done' : 'goaml-tracker__miniDot'} />
                      ))}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--color-neutral-700)', marginTop: 2 }}>{f.submissionStatus.replace('_', ' ')}</div>
                  </div>
                  <div className="tcell" style={{ fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>{f.goamlReference ?? 'pending'}</div>
                  <div className="tcell" style={{ textAlign: 'center' }}>
                    {f.retentionReviewDue && (
                      <span className="goaml-tracker__retFlag" title="Approaching 10-year disposal review">
                        R
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="goaml-tracker__detail">
          {!detail ? (
            <div className="tile aml-status" style={{ margin: 16 }}>
              Select a filing to see its status and follow-up log.
            </div>
          ) : (
            <div className="goaml-tracker__detailScroll">
              <div className="tile">
                <i className="corner tl" />
                <i className="corner tr" />
                <i className="corner bl" />
                <i className="corner br" />
                <div className="tile-body">
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginBottom: 12 }}>
                    <span style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>{detail.goamlReference ?? 'Reference pending'}</span>
                    <span className="tag tag-outline">{detail.submissionStatus.replace('_', ' ').toUpperCase()}</span>
                  </div>
                  <div className="goaml-tracker__stepper">
                    {STEPS.map((step, i) => (
                      <div key={step} className={`goaml-tracker__step ${i <= stepIndex(detail.submissionStatus) ? 'goaml-tracker__step--done' : ''}`}>
                        <div className="goaml-tracker__stepDot">{i < stepIndex(detail.submissionStatus) || (i === stepIndex(detail.submissionStatus)) ? '●' : ''}</div>
                        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 13 }}>{STEP_LABELS[i]}</div>
                      </div>
                    ))}
                  </div>
                  <div className="goaml-tracker__meta">
                    {detail.submittedAt && <div>Submitted: {new Date(detail.submittedAt).toLocaleString()}</div>}
                    {detail.acknowledgedAt && <div>Acknowledged: {new Date(detail.acknowledgedAt).toLocaleString()}</div>}
                    {detail.retentionExpiry && <div>Retention expiry: {new Date(detail.retentionExpiry).toLocaleDateString()}</div>}
                  </div>
                  {detail.submissionStatus === 'submitted' && (
                    <button className="aml-btn aml-btn--primary" disabled={acking} onClick={() => void handleAcknowledge()}>
                      {acking ? 'Simulating…' : 'Simulate acknowledgment (demo only)'}
                    </button>
                  )}
                  <button className="aml-btn" onClick={() => navigate(`${base}/cases/${detail.caseId}`)} style={{ marginLeft: 8 }}>
                    ← Back to case
                  </button>
                </div>
              </div>

              <div className="tile">
                <i className="corner tl" />
                <i className="corner tr" />
                <i className="corner bl" />
                <i className="corner br" />
                <div className="tile-head">
                  <span className="aml-label">FMU follow-up log</span>
                </div>
                <div className="tile-body">
                  {detail.followups.length === 0 ? (
                    <div className="goaml-tracker__muted">No follow-up notes yet.</div>
                  ) : (
                    detail.followups.map((f) => (
                      <div key={f.followupId} className="goaml-tracker__followup">
                        <div className="goaml-tracker__followupMeta">
                          {f.createdBy} · {new Date(f.createdAt).toLocaleString()}
                        </div>
                        <div>{f.note}</div>
                      </div>
                    ))
                  )}
                  <div className="goaml-tracker__addFollowup">
                    <input className="input" value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} placeholder="Add a follow-up note…" />
                    <button className="aml-btn" onClick={() => void handleAddFollowup()}>
                      Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
