import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { createTypology } from '../api/client';
import { useToast } from '../../../shell/ToastProvider';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { Tile } from '../regulatory-kb/kbShared';
import { errorText, useCanWriteTypologies } from './typologyUtils';
import './typology-console.css';

// Mirrors app-api's TYPOLOGY_CODE_PATTERN — here only for instant
// feedback; the API is the authority.
const CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** Screen 2 — New typology (screens/06-typology-rules-console.md).
 * Creates a v1 draft and goes straight to its Edit screen, where the
 * regression and promotion happen; nothing reaches the agent before. */
export function TypologyNewScreen() {
  const { canWrite, ready } = useCanWriteTypologies();
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  if (ready && !canWrite) return <Navigate to={`${base}/typologies`} replace />;

  const codeError =
    code && !CODE_PATTERN.test(code)
      ? 'Lowercase letters, digits and underscores; starts with a letter; 3–64 characters.'
      : code === 'no_significant_pattern'
        ? 'Reserved — that is the agent’s own “nothing fits” answer.'
        : null;
  const valid = !!code && !codeError && !!label.trim() && !!description.trim() && !!reason.trim();

  const submit = async () => {
    setBusy(true);
    try {
      await createTypology({
        typology_code: code,
        typology_label: label.trim(),
        rule_logic_description: description.trim(),
        reason: reason.trim(),
      });
      toast.success('Created as draft v1 — run the regression, then promote it to go live.');
      navigate(`${base}/typologies/${code}/edit`);
    } catch (err) {
      toast.error(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="typology-screen">
      <div className="typology-head">
        <div className="typology-head__main">
          <div className="typology-head__title">New typology</div>
          <div className="typology-muted">Starts as draft v1. The agent doesn’t see it until it passes the golden-dataset regression and is promoted.</div>
        </div>
      </div>
      <div className="typology-scroll">
        <Tile title="Typology" className="typology-version typology-version--draft">
          <div className="typology-form">
            <label className="typology-console__field">
              Code (permanent — can’t be renamed later)
              <input autoFocus value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="e.g. trade_based_mispricing" />
            </label>
            {codeError && <div className="typology-form__error">{codeError}</div>}
            <label className="typology-console__field">
              Label
              <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Short human-readable name" />
            </label>
            <label className="typology-console__field">
              Rule logic in plain language (this is what the agent reads)
              <textarea
                className="input"
                rows={7}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                style={{ width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            <label className="typology-console__field">
              Why it’s being added (required, recorded permanently)
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. FMU red-flag circular, Sept 2026" />
            </label>
            <div className="typology-console__actions">
              <Link className="aml-btn" to={`${base}/typologies`}>
                Cancel
              </Link>
              <button className="aml-btn aml-btn--primary" disabled={busy || !valid} onClick={() => void submit()}>
                {busy ? 'Creating…' : 'Create draft'}
              </button>
            </div>
          </div>
        </Tile>
      </div>
    </div>
  );
}
