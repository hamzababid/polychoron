import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addFollowup, getFilingDetail, listFilings, simulateAcknowledgment } from '../api/client';
import type { FilingDetail, FilingSummary } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import './goaml-tracker.css';

const STEPS = ['draft', 'submitted', 'acknowledged'] as const;

function stepIndex(status: FilingSummary['submissionStatus']): number {
  const i = STEPS.indexOf(status as (typeof STEPS)[number]);
  return i === -1 ? 0 : i;
}

/** specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md */
export function GoamlTrackerScreen() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [filings, setFilings] = useState<FilingSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FilingDetail | null>(null);
  const [followupNote, setFollowupNote] = useState('');
  const [acking, setAcking] = useState(false);

  const loadList = useCallback(() => {
    listFilings({ pageSize: 50 })
      .then((res) => setFilings(res.items))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
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
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedId]);

  const handleAcknowledge = async () => {
    if (!selectedId) return;
    setAcking(true);
    try {
      await simulateAcknowledgment(selectedId);
      loadList();
      const updated = await getFilingDetail(selectedId);
      setDetail(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) return <div className="aml-status aml-status--error">Could not load filings: {error}</div>;

  return (
    <div className="goaml-tracker">
      <div className="goaml-tracker__list aml-card">
        <div className="aml-label" style={{ marginBottom: 8 }}>
          Filings
        </div>
        {filings === null ? (
          <div className="aml-status">Loading…</div>
        ) : filings.length === 0 ? (
          <div className="aml-status">No filings submitted yet.</div>
        ) : (
          filings.map((f) => (
            <button
              key={f.filingId}
              className={`goaml-tracker__row ${selectedId === f.filingId ? 'goaml-tracker__row--selected' : ''}`}
              onClick={() => setSelectedId(f.filingId)}
            >
              <span className="aml-tag">{f.reportType.toUpperCase()}</span>
              <span className="goaml-tracker__rowStatus">{f.submissionStatus}</span>
              {f.retentionReviewDue && <span className="goaml-tracker__retentionFlag">retention review due</span>}
            </button>
          ))
        )}
      </div>

      <div className="goaml-tracker__detail">
        {!detail ? (
          <div className="aml-card aml-status">Select a filing to see its status and follow-up log.</div>
        ) : (
          <div className="aml-card">
            <div className="goaml-tracker__stepper">
              {STEPS.map((step, i) => (
                <div key={step} className={`goaml-tracker__step ${i <= stepIndex(detail.submissionStatus) ? 'goaml-tracker__step--done' : ''}`}>
                  {step}
                </div>
              ))}
            </div>

            <div className="goaml-tracker__meta">
              {detail.goamlReference && <div>goAML reference: {detail.goamlReference}</div>}
              {detail.submittedAt && <div>Submitted: {new Date(detail.submittedAt).toLocaleString()}</div>}
              {detail.acknowledgedAt && <div>Acknowledged: {new Date(detail.acknowledgedAt).toLocaleString()}</div>}
              {detail.retentionExpiry && <div>Retention expiry: {new Date(detail.retentionExpiry).toLocaleDateString()}</div>}
            </div>

            {detail.submissionStatus === 'submitted' && (
              <button className="aml-btn aml-btn--primary" disabled={acking} onClick={() => void handleAcknowledge()}>
                {acking ? 'Simulating…' : 'Simulate acknowledgment (demo only)'}
              </button>
            )}

            <button className="aml-btn" onClick={() => navigate(`/bfsi/aml_detection/cases/${detail.caseId}`)}>
              ← Back to case
            </button>

            <div className="goaml-tracker__followups">
              <div className="aml-label">FMU follow-up log</div>
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
                <input value={followupNote} onChange={(e) => setFollowupNote(e.target.value)} placeholder="Add a follow-up note…" />
                <button className="aml-btn" onClick={() => void handleAddFollowup()}>
                  Add
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
