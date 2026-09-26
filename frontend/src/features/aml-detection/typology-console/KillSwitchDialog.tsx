import { useState } from 'react';
import { disableKillSwitch, reactivateKillSwitch } from '../api/client';
import type { KillSwitchScope } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../shell/ToastProvider';
import { errorText } from './typologyUtils';

export type KillSwitchAction =
  | { action: 'disable'; typologyCode: string | null; typologyLabel?: string }
  | { action: 'reactivate'; target: KillSwitchScope };

/** Guardrail G6 (constitution rule 14) — the immediate, unversioned
 * stop, for the whole feature (typologyCode null) or one typology.
 * Used by the Library (feature-wide) and the Typology view. */
export function KillSwitchDialog({ request, onDone, onCancel }: { request: KillSwitchAction; onDone: () => void; onCancel: () => void }) {
  const { session } = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const disabling = request.action === 'disable';
  const scopeLabel = disabling
    ? request.typologyCode
      ? `“${request.typologyLabel ?? request.typologyCode}”`
      : 'AML Detection for this tenant'
    : (request.target.typologyCode ?? 'AML Detection');

  const confirm = async () => {
    if (!session) return;
    setBusy(true);
    try {
      if (disabling) {
        await disableKillSwitch({ typology_code: request.typologyCode ?? undefined, reason, disabled_by: session.user.userId });
        toast.success(
          request.typologyCode
            ? 'Typology kill switch activated — it is excluded from the agent’s catalog now.'
            : 'AML Detection kill switch activated for this tenant.',
        );
      } else {
        await reactivateKillSwitch(request.target.scopeId, session.user.userId);
        toast.success('Kill switch reactivated — normal agent processing resumes.');
      }
      onDone();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="typology-console__dialogBackdrop" role="dialog" aria-modal="true">
      <div className="tile typology-console__dialog" style={disabling ? { boxShadow: 'inset 0 0 0 2px var(--color-alert)' } : undefined}>
        <i className="corner tl" />
        <i className="corner tr" />
        <i className="corner bl" />
        <i className="corner br" />
        <div className="tile-head" style={{ fontFamily: 'var(--font-heading)', fontSize: 14, color: disabling ? 'var(--color-alert)' : undefined }}>
          {disabling ? `Disable ${scopeLabel}?` : `Reactivate ${scopeLabel}?`}
        </div>
        <div className="tile-body" style={{ fontSize: 13 }}>
          {disabling ? (
            <>
              <p style={{ margin: '0 0 8px', color: 'var(--color-alert)' }}>
                {request.typologyCode
                  ? 'Takes effect immediately, without a draft or regression: the typology is excluded from Pattern Matching’s catalog until reactivated.'
                  : 'Every new alert for this tenant will route straight to manual review — Pattern Matching and Case & Narrative will not run at all until this is reactivated.'}
              </p>
              <label className="typology-console__field">
                Reason (required)
                <textarea
                  className="input"
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  style={{ width: '100%', boxSizing: 'border-box' }}
                  autoFocus
                />
              </label>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-neutral-700)' }}>
                This action and its reason are permanently logged and auditable.
              </p>
            </>
          ) : (
            <p style={{ margin: '0 0 8px' }}>
              Normal agent processing resumes immediately. Disabled since {new Date(request.target.disabledAt).toLocaleString()}: “
              {request.target.reason}”
            </p>
          )}
          <div className="typology-detail__dialogActions">
            <button className="aml-btn" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button
              className="aml-btn aml-btn--primary"
              style={disabling ? { background: 'var(--color-alert)', borderColor: 'var(--color-alert)' } : undefined}
              disabled={busy || (disabling && !reason.trim())}
              onClick={() => void confirm()}
            >
              {busy ? 'Working…' : disabling ? 'Disable' : 'Reactivate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
