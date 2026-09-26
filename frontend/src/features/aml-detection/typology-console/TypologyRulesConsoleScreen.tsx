import { useCallback, useEffect, useMemo, useState } from 'react';
import { disableKillSwitch, listKillSwitches, listTypologies, reactivateKillSwitch } from '../api/client';
import type { KillSwitchScope, TypologyConsoleOverview, TypologyStatus } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { useToast } from '../../../shell/ToastProvider';
import { NewTypologyDialog } from './NewTypologyDialog';
import { TypologyDetailPanel } from './TypologyDetailPanel';
import { TypologyStatusBadge } from './TypologyStatusBadge';
import './typology-console.css';

const CAN_WRITE_ROLES = ['aml_detection.mlro_compliance_head'];
// "Tuning candidates only" (design-exports/.../Typology Rules
// Console.dc.html) flags rules with weak STR conversion — a real
// computed threshold, not user-configurable yet (the mockup exposes
// it as an admin-tunable prop; there's no settings surface for that
// here, so it's a fixed constant instead of a fake control).
const TUNING_CONVERSION_THRESHOLD = 0.1;
const HIGH_FP_THRESHOLD = 0.5;

type StatusFilter = 'all' | TypologyStatus | 'draft_open';

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * — restyled to match design-exports/bfsi/aml-detection/Typology
 * Rules Console.dc.html's rule-registry layout (the first pass missed
 * the design export and built a plain data-grid instead).
 *
 * Two things the mockup shows that this build deliberately does NOT
 * fabricate:
 * 1. The mockup's "Detection logic" panel has six structured fields
 *    (trigger threshold, observation window, FMU category, scope,
 *    suppression, risk weighting). aml_typology_configs only stores
 *    one free-text rule_logic_description — there's no column for
 *    those six fields. Real metadata (production version, who/why it
 *    last changed) is shown instead; inventing a taxonomy for fields
 *    that don't exist in the schema would be exactly the kind of
 *    fabricated demo content this project's constitution rules out.
 * 2. The mockup's backtest sandbox shows a full shadow-mode
 *    comparison: alert volume/STR conversion/false-positive rate
 *    before vs. after, a monthly live-vs-draft chart, and a written
 *    model-risk narrative. TypologyConsoleService.startBacktest()
 *    computes one real number — the CURRENT production agreement
 *    rate from historical Case/Disposition data — and says so in its
 *    own comparisonReport.method text (see typology-console.service.ts
 *    for why: a true shadow re-run means re-invoking Pattern Matching
 *    against historical evidence bundles with the draft config, a
 *    larger follow-up, not built yet). That real, narrower number is
 *    what's shown here, not an invented before/after.
 *
 * v2 lifecycle (same spec, "Typology lifecycle"): the table lists every
 * typology incl. never-promoted ones; the detail panel
 * (TypologyDetailPanel) edits drafts only and gates Promote on a
 * passing golden-dataset regression.
 */
export function TypologyRulesConsoleScreen() {
  const { session } = useAuth();
  const toast = useToast();
  const canWrite = session ? CAN_WRITE_ROLES.some((r) => session.user.roleCodes.includes(r)) : false;

  const [overview, setOverview] = useState<TypologyConsoleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [killSwitches, setKillSwitches] = useState<KillSwitchScope[]>([]);
  const [killSwitchReason, setKillSwitchReason] = useState('');
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);
  const [killSwitchModal, setKillSwitchModal] = useState<
    | { action: 'disable'; scope: 'feature' }
    | { action: 'disable'; scope: 'typology'; typologyCode: string; typologyLabel: string }
    | { action: 'reactivate'; target: KillSwitchScope }
    | null
  >(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [tuningOnly, setTuningOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(() => {
    listTypologies()
      .then(setOverview)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const loadKillSwitches = useCallback(() => {
    listKillSwitches()
      .then(setKillSwitches)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    loadKillSwitches();
  }, [load, loadKillSwitches]);

  const rows = overview?.typologies ?? [];
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter === 'draft_open' && !r.draft) return false;
      if (statusFilter !== 'all' && statusFilter !== 'draft_open' && r.status !== statusFilter) return false;
      if (tuningOnly && r.strConversionRate >= TUNING_CONVERSION_THRESHOLD) return false;
      if (search.trim() && !`${r.typologyLabel} ${r.typologyCode}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
      return true;
    });
  }, [rows, statusFilter, tuningOnly, search]);

  const selected = rows.find((r) => r.typologyCode === selectedCode) ?? null;

  const featureKillSwitch = killSwitches.find((k) => k.typologyCode === null) ?? null;
  const typologyKillSwitch = selectedCode ? killSwitches.find((k) => k.typologyCode === selectedCode) ?? null : null;

  const openDisableFeatureModal = () => {
    setKillSwitchReason('');
    setKillSwitchModal({ action: 'disable', scope: 'feature' });
  };

  const openDisableTypologyModal = () => {
    if (!selected) return;
    setKillSwitchReason('');
    setKillSwitchModal({ action: 'disable', scope: 'typology', typologyCode: selected.typologyCode, typologyLabel: selected.typologyLabel });
  };

  const handleCreated = (code: string) => {
    setNewOpen(false);
    load();
    setSelectedCode(code);
  };

  const openReactivateModal = (target: KillSwitchScope) => setKillSwitchModal({ action: 'reactivate', target });

  const handleConfirmKillSwitchAction = async () => {
    if (!session || !killSwitchModal) return;
    setKillSwitchBusy(true);
    try {
      if (killSwitchModal.action === 'disable') {
        const typologyCode = killSwitchModal.scope === 'typology' ? killSwitchModal.typologyCode : undefined;
        await disableKillSwitch({ typology_code: typologyCode, reason: killSwitchReason, disabled_by: session.user.userId });
        toast.success(typologyCode ? 'Typology kill switch activated — routes straight to manual review.' : 'AML Detection kill switch activated for this tenant.');
      } else {
        await reactivateKillSwitch(killSwitchModal.target.scopeId, session.user.userId);
        toast.success('Kill switch reactivated — normal agent processing resumes.');
      }
      setKillSwitchModal(null);
      setKillSwitchReason('');
      loadKillSwitches();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setKillSwitchBusy(false);
    }
  };

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!overview) return <div className="aml-status">Loading typology console…</div>;

  const liveCount = rows.filter((r) => r.status === 'live').length;
  const retiredCount = rows.filter((r) => r.status === 'retired').length;
  const draftsOpenCount = rows.filter((r) => r.draft).length;
  const alerts30d = rows.reduce((sum, r) => sum + r.alertVolume30d, 0);

  return (
    <div className="typology-console">
      <div className="typology-console__strip">
        <div className="typology-console__stripCell typology-console__stripTitle">
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 19 }}>Typology &amp; rules console</div>
          <div style={{ fontSize: 11.5, color: 'var(--color-neutral-700)' }}>{rows.length} typologies configured</div>
        </div>
        <div className="typology-console__stripCell" style={{ display: 'flex', gap: 24 }}>
          <div>
            <div className="aml-label">Live rules</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{liveCount}</div>
          </div>
          <div>
            <div className="aml-label">Retired</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{retiredCount}</div>
          </div>
          <div>
            <div className="aml-label" style={{ color: draftsOpenCount > 0 ? 'var(--color-accent-700)' : undefined }}>
              Drafts open
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20, color: draftsOpenCount > 0 ? 'var(--color-accent-700)' : undefined }}>
              {draftsOpenCount}
            </div>
          </div>
          <div>
            <div className="aml-label">Alerts last 30d</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>{alerts30d}</div>
          </div>
        </div>
        <div className="typology-console__stripCell">
          <div className="aml-label">Change control</div>
          <div style={{ fontSize: 12 }}>
            {overview.lastPromotion
              ? `Last promotion: ${overview.lastPromotion.typologyLabel} v${overview.lastPromotion.promotedVersion} by ${overview.lastPromotion.promotedBy}, ${new Date(overview.lastPromotion.promotedAt).toLocaleDateString()}`
              : 'No promotions recorded yet.'}
          </div>
        </div>
      </div>

      <div
        className="tile"
        style={{
          margin: '0 0 12px',
          padding: '9px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: featureKillSwitch ? 'color-mix(in srgb, var(--color-alert) 10%, transparent)' : undefined,
          boxShadow: featureKillSwitch ? 'inset 0 0 0 2px var(--color-alert)' : undefined,
        }}
      >
        <span className="aml-label" style={{ color: featureKillSwitch ? 'var(--color-alert)' : undefined }}>
          Kill switch (guardrail G6)
        </span>
        {featureKillSwitch ? (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--color-alert)' }}>
              AML Detection is DISABLED for this tenant — every new alert routes straight to manual review. Disabled by{' '}
              {featureKillSwitch.disabledBy} on {new Date(featureKillSwitch.disabledAt).toLocaleString()}: “{featureKillSwitch.reason}”
            </span>
            {canWrite && (
              <button className="aml-btn aml-btn--primary" disabled={killSwitchBusy} onClick={() => openReactivateModal(featureKillSwitch)}>
                Reactivate…
              </button>
            )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>AML Detection's agent chain is active for this tenant.</span>
            {canWrite && (
              <button className="aml-btn" style={{ marginLeft: 'auto' }} disabled={killSwitchBusy} onClick={openDisableFeatureModal}>
                Disable entire feature…
              </button>
            )}
          </>
        )}
      </div>

      <div className="typology-console__filterBar">
        <span className="aml-label" style={{ marginRight: 2 }}>
          Filter
        </span>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}>
          <option value="all">Status: all</option>
          <option value="live">Live</option>
          <option value="retired">Retired</option>
          <option value="not_live">Not yet live</option>
          <option value="draft_open">Draft open</option>
        </select>
        <label className="typology-console__tuneToggle">
          <input type="checkbox" checked={tuningOnly} onChange={(e) => setTuningOnly(e.target.checked)} />
          Tuning candidates only
          <span style={{ fontSize: 11, color: 'var(--color-neutral-600)' }}>conversion under {(TUNING_CONVERSION_THRESHOLD * 100).toFixed(0)}%</span>
        </label>
        <input
          className="input"
          placeholder="Typology name or code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginLeft: 'auto', width: 240, fontSize: 12.5 }}
        />
        {canWrite && (
          <button className="aml-btn aml-btn--primary" onClick={() => setNewOpen(true)}>
            New typology…
          </button>
        )}
      </div>

      <div className="typology-console__scroll">
        <div className="typology-console__tableHead">
          <div className="typology-console__ahd">Typology · code</div>
          <div className="typology-console__ahd">Status</div>
          <div className="typology-console__ahd" style={{ textAlign: 'right' }}>
            Alerts 30d
          </div>
          <div className="typology-console__ahd">STR conversion</div>
          <div className="typology-console__ahd" style={{ textAlign: 'right' }}>
            False positive
          </div>
        </div>

        {filteredRows.length === 0 ? (
          <div className="typology-console__muted" style={{ padding: '18px 14px' }}>
            No typologies match these filters.
          </div>
        ) : (
          filteredRows.map((r) => (
            <div
              key={r.typologyCode}
              className={`typology-console__row ${r.status === 'live' ? 'typology-console__row--live' : 'typology-console__row--draft'} ${selectedCode === r.typologyCode ? 'typology-console__row--selected' : ''}`}
              onClick={() => setSelectedCode(r.typologyCode)}
              style={{ opacity: r.status === 'live' ? 1 : 0.75 }}
            >
              <div className="typology-console__cell">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{r.typologyLabel}</span>
                  {r.draft && <span className="typology-console__draftBadge">DRAFT v{r.draft.version} OPEN</span>}
                  {r.hasActiveBacktest && <span className="typology-console__draftBadge">IN BACKTEST</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>
                  {r.typologyCode} · {r.productionVersion != null ? `v${r.productionVersion} live` : 'never promoted'}
                </div>
              </div>
              <div className="typology-console__cell">
                <TypologyStatusBadge status={r.status} killSwitched={r.killSwitched} />
              </div>
              <div className="typology-console__cell" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {r.status === 'not_live' ? '—' : r.alertVolume30d}
              </div>
              <div className="typology-console__cell">
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span
                    style={{
                      fontFamily: 'var(--font-heading)',
                      fontSize: 15,
                      width: 44,
                      color: r.strConversionRate < TUNING_CONVERSION_THRESHOLD ? 'var(--color-accent-700)' : 'var(--color-text)',
                    }}
                  >
                    {(r.strConversionRate * 100).toFixed(1)}%
                  </span>
                  <span style={{ width: 44, height: 8, background: 'var(--color-neutral-300)', flex: 'none' }}>
                    <span
                      style={{
                        display: 'block',
                        height: 8,
                        width: `${Math.min(100, r.strConversionRate * 300)}%`,
                        background: r.strConversionRate < TUNING_CONVERSION_THRESHOLD ? 'var(--color-accent-700)' : 'var(--color-accent-600)',
                      }}
                    />
                  </span>
                </div>
                {r.strConversionRate < TUNING_CONVERSION_THRESHOLD && <div style={{ fontSize: 10.5, color: 'var(--color-accent-700)' }}>tuning candidate</div>}
              </div>
              <div className="typology-console__cell" style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: r.falsePositiveRate > HIGH_FP_THRESHOLD ? 'var(--color-accent-700)' : 'var(--color-text)' }}>
                  {(r.falsePositiveRate * 100).toFixed(1)}%
                </div>
                {r.falsePositiveRate > HIGH_FP_THRESHOLD && <div style={{ fontSize: 10.5, color: 'var(--color-accent-700)' }}>above {(HIGH_FP_THRESHOLD * 100).toFixed(0)}% tolerance</div>}
              </div>
            </div>
          ))
        )}

        {selected && (
          <TypologyDetailPanel
            code={selected.typologyCode}
            canWrite={canWrite}
            killSwitch={typologyKillSwitch}
            killSwitchBusy={killSwitchBusy}
            onDisableKillSwitch={openDisableTypologyModal}
            onReactivateKillSwitch={openReactivateModal}
            onChanged={load}
          />
        )}
      </div>

      {newOpen && <NewTypologyDialog onClose={() => setNewOpen(false)} onCreated={handleCreated} />}

      {killSwitchModal && (
        <div className="typology-console__dialogBackdrop">
          <div
            className="tile typology-console__dialog"
            style={killSwitchModal.action === 'disable' ? { boxShadow: 'inset 0 0 0 2px var(--color-alert)' } : undefined}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            <div
              className="tile-head"
              style={{ fontFamily: 'var(--font-heading)', fontSize: 14, color: killSwitchModal.action === 'disable' ? 'var(--color-alert)' : undefined }}
            >
              {killSwitchModal.action === 'disable'
                ? killSwitchModal.scope === 'feature'
                  ? 'Disable AML Detection for this tenant?'
                  : `Disable "${killSwitchModal.typologyCode}"?`
                : `Reactivate ${killSwitchModal.target.typologyCode ?? 'AML Detection'}?`}
            </div>
            <div className="tile-body" style={{ fontSize: 13 }}>
              {killSwitchModal.action === 'disable' ? (
                <>
                  <p style={{ margin: '0 0 8px', color: 'var(--color-alert)' }}>
                    {killSwitchModal.scope === 'feature'
                      ? 'Every new alert for this tenant will route straight to manual review — Pattern Matching and Case & Narrative will not run at all until this is reactivated.'
                      : 'This typology will be excluded from Pattern Matching\'s catalog entirely — the agent will not be able to match against it until this is reactivated.'}
                  </p>
                  <label className="typology-console__field">
                    Reason (required)
                    <textarea
                      className="input"
                      rows={3}
                      value={killSwitchReason}
                      onChange={(e) => setKillSwitchReason(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box' }}
                      autoFocus
                    />
                  </label>
                  <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--color-neutral-700)' }}>
                    This action and its reason are permanently logged and auditable.
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                    <button className="aml-btn" onClick={() => setKillSwitchModal(null)}>
                      Cancel
                    </button>
                    <button
                      className="aml-btn aml-btn--primary"
                      style={{ background: 'var(--color-alert)', borderColor: 'var(--color-alert)' }}
                      disabled={killSwitchBusy || !killSwitchReason.trim()}
                      onClick={() => void handleConfirmKillSwitchAction()}
                    >
                      {killSwitchBusy ? 'Disabling…' : 'Disable'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p style={{ margin: '0 0 8px' }}>
                    Normal agent processing resumes immediately for{' '}
                    {killSwitchModal.target.typologyCode ? `this typology` : 'this tenant'}. Currently disabled since{' '}
                    {new Date(killSwitchModal.target.disabledAt).toLocaleString()}: “{killSwitchModal.target.reason}”
                  </p>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                    <button className="aml-btn" onClick={() => setKillSwitchModal(null)}>
                      Cancel
                    </button>
                    <button className="aml-btn aml-btn--primary" disabled={killSwitchBusy} onClick={() => void handleConfirmKillSwitchAction()}>
                      {killSwitchBusy ? 'Reactivating…' : 'Reactivate'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
