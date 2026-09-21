import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { attestFiling, getFilingDraft, submitFiling } from '../api/client';
import type { FilingDraftResponse, StrFieldsDraft } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { useToast } from '../../../shell/ToastProvider';
import './filing-console.css';

// Mirrors agent-service/app/features/aml_detection/typology_catalog.py's
// Phase 1 catalog — the officer can retag to either of these, or leave
// the agent's original tag.
const TYPOLOGY_OPTIONS = [
  { code: 'structuring_subthreshold', label: 'Structuring — sub-threshold cash deposits' },
  { code: 'deposit_velocity_shift', label: 'Deposit velocity shift' },
];

function SectionHead({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <div className="filing-console__sectionHead">
      <span className="filing-console__sectionNum">SECTION {n}</span>
      <h4 style={{ margin: 0 }}>{title}</h4>
      {note && <span className="filing-console__sectionNote">{note}</span>}
    </div>
  );
}

/** specs/suites/bfsi/features/aml-detection/screens/04-filing-console.md
 * restyled to match design-exports/.../Filing Console.dc.html's
 * section-numbered layout and — the highest-stakes visual element on
 * this screen — its amber tipping-off/attestation panel treatment.
 * Attestation gate built first: submit is client-disabled until the
 * checklist + attestation are complete, and the server independently
 * re-validates can_submit at submit time. */
export function FilingConsoleScreen() {
  const { caseId = '' } = useParams();
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const { session } = useAuth();
  const toast = useToast();
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
  const checksMet = [checklistItems.noContact, checklistItems.noFreeze, checklistItems.noDisclosure].filter(Boolean).length;

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
    try {
      const updated = await attestFiling(caseId, buildAttestBody());
      setDraft(updated);
      toast.success('Draft saved.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    try {
      await attestFiling(caseId, buildAttestBody());
      // submit() re-validates can_submit server-side — never trusts
      // that this button being enabled means the server will agree.
      const submitted = await submitFiling(caseId);
      setDraft(submitted);
      toast.success('Filing submitted to goAML.');
      navigate(`${base}/filings`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (isFinal) {
    return (
      <div className="filing-console__final">
        <div className="tile" style={{ maxWidth: 480 }}>
          <i className="corner tl" />
          <i className="corner tr" />
          <i className="corner bl" />
          <i className="corner br" />
          <div className="tile-head">
            <span className="aml-label">Filing status</span>
          </div>
          <div className="tile-body">
            <div className="filing-console__finalStatus">{draft.submissionStatus}</div>
            {draft.goamlReference && <div>goAML reference: {draft.goamlReference}</div>}
            {draft.submittedAt && <div>Submitted: {new Date(draft.submittedAt).toLocaleString()}</div>}
            {draft.acknowledgedAt && <div>Acknowledged: {new Date(draft.acknowledgedAt).toLocaleString()}</div>}
            <button className="aml-btn" onClick={() => navigate(`${base}/filings`)} style={{ marginTop: 10 }}>
              Go to goAML Tracker
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="filing-console">
      <div className="filing-console__scroll">
        <div className="filing-console__col">
          <div>
            <SectionHead n={1} title="Case summary — read-only" />
            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="filing-console__grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="filing-console__cell">
                  <div className="aml-label">Risk score</div>
                  <div className="filing-console__val">{draft.riskScore} / 100</div>
                </div>
                <div className="filing-console__cell">
                  <div className="aml-label">Agent recommendation</div>
                  <div className="filing-console__val">{draft.recommendation.replace('_', ' ')}</div>
                </div>
              </div>
            </div>
            <button className="aml-btn" onClick={() => navigate(`${base}/cases/${caseId}`)} style={{ marginTop: 8 }}>
              ← Back to Case Workspace
            </button>
          </div>

          <div>
            <SectionHead n={2} title="STR-F fields" note="officer-editable" />
            <div className="tile">
              <i className="corner tl" />
              <i className="corner tr" />
              <i className="corner bl" />
              <i className="corner br" />
              <div className="filing-console__fields">
                <label className="field">
                  <span>Party name</span>
                  <input className="input" value={payload.party_name} onChange={(e) => setPayload({ ...payload, party_name: e.target.value })} />
                </label>
                <label className="field">
                  <span>CNIC</span>
                  <input className="input" value={payload.party_cnic} onChange={(e) => setPayload({ ...payload, party_cnic: e.target.value })} />
                </label>
                <label className="field">
                  <span>Address</span>
                  <input className="input" value={payload.party_address} onChange={(e) => setPayload({ ...payload, party_address: e.target.value })} />
                </label>
                <label className="field">
                  <span>Occupation</span>
                  <input className="input" value={payload.party_occupation} onChange={(e) => setPayload({ ...payload, party_occupation: e.target.value })} />
                </label>
                <label className="field">
                  <span>Total amount ({payload.currency})</span>
                  <input
                    className="input"
                    type="number"
                    value={payload.total_amount}
                    onChange={(e) => setPayload({ ...payload, total_amount: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  <span>Typology tag</span>
                  <select className="input" value={payload.typology_tag} onChange={(e) => setPayload({ ...payload, typology_tag: e.target.value })}>
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
          </div>

          <div>
            <SectionHead n={3} title="Suspicion narrative" note="Goes to the FMU verbatim." />
            <div className="aml-source-ai">
              <div className="ai-band">AI-DRAFTED — REVIEW BEFORE SUBMITTING</div>
              <textarea className="input filing-console__narrative" value={narrative} onChange={(e) => setNarrative(e.target.value)} rows={9} />
            </div>
          </div>
        </div>

        <div className="filing-console__col">
          <div>
            <SectionHead n={4} title="Tipping-off check & officer attestation" note="AMLA 2010 s.33" />
            <div className="filing-console__attestation">
              <div className="filing-console__attestationBand">
                TIPPING-OFF CHECK &amp; OFFICER ATTESTATION
                <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.85 }}>disclosure to the customer is a criminal offence</span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 11 }}>
                <div className="filing-console__attestNote">
                  Confirm each statement below from your own knowledge of the account. Nothing here is pre-checked.
                </div>

                <label className="filing-console__check">
                  <input
                    type="checkbox"
                    checked={checklistItems.noContact}
                    onChange={(e) => setChecklistItems({ ...checklistItems, noContact: e.target.checked })}
                  />
                  <span>No branch staff, relationship manager or call-centre agent has contacted the customer about these transactions.</span>
                </label>
                <label className="filing-console__check">
                  <input
                    type="checkbox"
                    checked={checklistItems.noFreeze}
                    onChange={(e) => setChecklistItems({ ...checklistItems, noFreeze: e.target.checked })}
                  />
                  <span>No account freeze, hold, closure or restriction has been applied to this account since the alert was raised.</span>
                </label>
                <label className="filing-console__check">
                  <input
                    type="checkbox"
                    checked={checklistItems.noDisclosure}
                    onChange={(e) => setChecklistItems({ ...checklistItems, noDisclosure: e.target.checked })}
                  />
                  <span>The existence of this report has not been disclosed to the customer or to any person outside the compliance function.</span>
                </label>

                <div className="filing-console__attestDivider" />

                <label className="filing-console__check filing-console__check--main">
                  <input type="checkbox" checked={attestationConfirmed} onChange={(e) => setAttestationConfirmed(e.target.checked)} />
                  <span>
                    I, {session?.user.displayName ?? 'the reporting officer'} ({session?.user.roleCodes[0]}), have reviewed this filing in
                    full and it reflects my own professional judgment. I understand this report is submitted to the FMU, that the
                    narrative above — including any agent-drafted text — is adopted as my own statement, and that this attestation is
                    recorded against my name and cannot be withdrawn after submission.
                  </span>
                </label>

                <div style={{ fontSize: 11, color: 'var(--color-accent-700)' }}>
                  {checksMet} of 3 tipping-off checks · attestation {attestationConfirmed ? 'signed' : 'not signed'}
                </div>
              </div>
            </div>
          </div>

          <div className="filing-console__actionBar">
            <div style={{ fontSize: 12, color: canSubmit ? 'var(--color-text)' : 'var(--color-accent-700)', lineHeight: 1.4 }}>
              {canSubmit
                ? 'Attestation complete. Submitting transmits the filing to the FMU and cannot be recalled.'
                : `Submission is locked: ${3 - checksMet > 0 ? `${3 - checksMet} tipping-off check(s) outstanding` : 'officer attestation unsigned'}.`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="aml-btn" disabled={saving} onClick={() => void handleSaveDraft()}>
                Save as draft
              </button>
              <button className="aml-btn aml-btn--primary" disabled={!canSubmit || saving} onClick={() => void handleSubmit()}>
                {saving ? 'Submitting…' : 'Submit to goAML'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
