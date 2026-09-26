import { useState } from 'react';
import { createTypology } from '../api/client';
import { useToast } from '../../../shell/ToastProvider';

// Mirrors app-api's TYPOLOGY_CODE_PATTERN — checked here only for
// instant feedback; the API is the authority.
const CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

/** screens/06-typology-rules-console.md — "New typology". Creates a v1
 * draft; nothing reaches the agent until it is promoted. */
export function NewTypologyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string) => void }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

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
      toast.success('Typology created as a draft — run the regression, then promote it to go live.');
      onCreated(code);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="typology-console__dialogBackdrop">
      <div className="tile typology-console__dialog" style={{ width: 'min(620px, 92vw)' }}>
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div className="tile-head" style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>
          New typology
        </div>
        <div className="tile-body" style={{ fontSize: 13 }}>
          <p style={{ margin: '0 0 10px', color: 'var(--color-neutral-700)' }}>
            Starts as draft v1. The agent doesn't see it until it passes the golden-dataset regression and is promoted.
          </p>
          <label className="typology-console__field">
            Code (permanent — can't be renamed later)
            <input autoFocus value={code} onChange={(e) => setCode(e.target.value.trim())} placeholder="e.g. trade_based_mispricing" />
          </label>
          {codeError && <div style={{ fontSize: 11.5, color: 'var(--color-alert)', marginTop: -4, marginBottom: 6 }}>{codeError}</div>}
          <label className="typology-console__field">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Short human-readable name" />
          </label>
          <label className="typology-console__field">
            Rule logic in plain language (what the agent will read)
            <textarea
              className="input"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <label className="typology-console__field">
            Why it's being added (required)
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. FMU red-flag circular, Sept 2026" />
          </label>
          <div className="typology-detail__dialogActions">
            <button className="aml-btn" onClick={onClose}>
              Cancel
            </button>
            <button className="aml-btn aml-btn--primary" disabled={busy || !valid} onClick={() => void submit()}>
              {busy ? 'Creating…' : 'Create draft'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
