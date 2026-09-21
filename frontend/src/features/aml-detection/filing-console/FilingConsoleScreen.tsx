import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { attestFiling, getFilingDraft, submitFiling } from '../api/client';
import type { FilingDraftResponse, StrFieldsDraft } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatureBasePath } from '../useFeatureBasePath';
import './filing-console.css';

// Mirrors agent-service/app/features/aml_detection/typology_catalog.py's
// Phase 1 catalog — the officer can retag to either of these, or leave
// the agent's original tag.
const TYPOLOGY_OPTIONS = [
  { code: 'structuring_subthreshold', label: 'Structuring — sub-threshold cash deposits' },
  { code: 'deposit_velocity_shift', label: 'Deposit velocity shift' },
];

export function FilingConsoleScreen() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const { session } = useAuth();
  const [draft, setDraft] = useState<FilingDraftResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [payload, setPayload] = useState<StrFieldsDraft | null>(null);
  const [narrative, setNarrative] = useState('');
  const [checklistItems, setChecklistItems] = useState({ noContact: false, noFreeze: false, noDisclosure: false });
  const [attestationConfirmed, setAttestationConfirmed] = useState(false);

  const load = useCallback(() => {
    getFilingDraft(caseId)
      .then((res) => {
        setDraft(res);
        setPayload(res.strFieldsDraft);
        setNarrative(res.narrative);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [caseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <div className="aml-status aml-status--error">Could not load filing draft: {error}</div>;
  if (!draft || !payload) return <div className="aml-status">Loading filing draft…</div>;

  const isFinal = draft.submissionStatus === 'submitted' || draft.submissionStatus === 'acknowledged';
  const tippingOffComplete = checklistItems.noContact && checklistItems.noFreeze && checklistItems.noDisclosure;
  const canSubmit = tippingOffComplete && attestationConfirmed;

  const buildAttestBody = () => ({
    officer_id: session!.user.userId,
    officer_name: session!.user.displayName,
    officer_role: session!.user.roleCodes[0] ?? 'senior_officer_l2',
    tipping_off_checklist_complete: tippingOffComplete,
    attestation_confirmed: attestationConfirmed,
    payload: payload!,
    final_narrative: narrative,
  });

  const handleSaveDraft = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await attestFiling(caseId, buildAttestBody());
      setDraft(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await attestFiling(caseId, buildAttestBody());
      // submit() re-validates can_submit server-side — never trusts
      // that this button being enabled means the server will agree.
      const submitted = await submitFiling(caseId);
      setDraft(submitted);
      navigate(`${base}/filings`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (isFinal) {
    return (
      <div className="aml-card filing-console__final">
        <div className="aml-label">Filing status</div>
        <div className="filing-console__finalStatus">{draft.submissionStatus}</div>
        {draft.goamlReference && <div>goAML reference: {draft.goamlReference}</div>}
        {draft.submittedAt && <div>Submitted: {new Date(draft.submittedAt).toLocaleString()}</div>}
        {draft.acknowledgedAt && <div>Acknowledged: {new Date(draft.acknowledgedAt).toLocaleString()}</div>}
        <button className="aml-btn" onClick={() => navigate(`${base}/filings`)}>
          Go to goAML Tracker
        </button>
      </div>
    );
  }

  return (
    <div className="filing-console">
      <div className="aml-card">
        <div className="aml-label">Case summary</div>
        <div>Risk score: {draft.riskScore}/100 · Agent recommendation: {draft.recommendation.replace('_', ' ')}</div>
        <button className="aml-btn" onClick={() => navigate(`${base}/cases/${caseId}`)}>
          ← Back to Case Workspace
        </button>
      </div>

      <div className="aml-card">
        <div className="aml-label">STR-F fields (officer-editable)</div>
        <div className="filing-console__fields">
          <label>
            Party name
            <input value={payload.party_name} onChange={(e) => setPayload({ ...payload, party_name: e.target.value })} />
          </label>
          <label>
            CNIC
            <input value={payload.party_cnic} onChange={(e) => setPayload({ ...payload, party_cnic: e.target.value })} />
          </label>
          <label>
            Address
            <input value={payload.party_address} onChange={(e) => setPayload({ ...payload, party_address: e.target.value })} />
          </label>
          <label>
            Occupation
            <input value={payload.party_occupation} onChange={(e) => setPayload({ ...payload, party_occupation: e.target.value })} />
          </label>
          <label>
            Total amount ({payload.currency})
            <input
              type="number"
              value={payload.total_amount}
              onChange={(e) => setPayload({ ...payload, total_amount: Number(e.target.value) })}
            />
          </label>
          <label>
            Typology tag
            <select value={payload.typology_tag} onChange={(e) => setPayload({ ...payload, typology_tag: e.target.value })}>
              {!TYPOLOGY_OPTIONS.some((o) => o.code === payload.typology_tag) && (
                <option value={payload.typology_tag}>{payload.typology_tag} (agent-assigned)</option>
              )}
              {TYPOLOGY_OPTIONS.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="aml-source-ai">
        <div className="aml-source-ai__label">AI-drafted narrative — review before submitting</div>
        <textarea className="filing-console__narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={6} />
      </div>

      <div className="filing-console__attestation">
        <div className="filing-console__attestationTitle">Attestation — required before submission</div>
        <label className="filing-console__check">
          <input
            type="checkbox"
            checked={checklistItems.noContact}
            onChange={(e) => setChecklistItems({ ...checklistItems, noContact: e.target.checked })}
          />
          I have not contacted the customer about this matter.
        </label>
        <label className="filing-console__check">
          <input
            type="checkbox"
            checked={checklistItems.noFreeze}
            onChange={(e) => setChecklistItems({ ...checklistItems, noFreeze: e.target.checked })}
          />
          No account freeze or closure has been initiated as a result of this filing.
        </label>
        <label className="filing-console__check">
          <input
            type="checkbox"
            checked={checklistItems.noDisclosure}
            onChange={(e) => setChecklistItems({ ...checklistItems, noDisclosure: e.target.checked })}
          />
          No disclosure of this filing has been or will be made to the customer or unauthorized parties.
        </label>
        <label className="filing-console__check filing-console__check--main">
          <input type="checkbox" checked={attestationConfirmed} onChange={(e) => setAttestationConfirmed(e.target.checked)} />I,{' '}
          {session?.user.displayName} ({session?.user.roleCodes[0]}), attest that I have reviewed this filing and it is accurate
          to the best of my knowledge.
        </label>

        <div className="filing-console__actions">
          <button className="aml-btn" disabled={saving} onClick={() => void handleSaveDraft()}>
            Save as draft
          </button>
          <button className={`aml-btn aml-btn--primary filing-console__submit ${!canSubmit ? 'filing-console__submit--disabled' : ''}`} disabled={!canSubmit || saving} onClick={() => void handleSubmit()}>
            {saving ? 'Submitting…' : 'Submit filing'}
          </button>
        </div>
      </div>
    </div>
  );
}
