import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getTypology, getTypologyHistory, listKillSwitches, listTypologies, openTypologyDraft } from '../api/client';
import type { KillSwitchScope, TypologyDetail, TypologyHistory, TypologyRow } from '../api/types';
import { useToast } from '../../../shell/ToastProvider';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { Tile } from '../regulatory-kb/kbShared';
import { KillSwitchDialog, type KillSwitchAction } from './KillSwitchDialog';
import { TypologyStatusBadge } from './TypologyStatusBadge';
import { HistoryTile, RegressionSummary, VersionContent, VersionDiff, VersionTile } from './typologyShared';
import { errorText, formatDate, useCanWriteTypologies } from './typologyUtils';
import './typology-console.css';

/** Screen 3 — Typology view (screens/06-typology-rules-console.md).
 * Read-only: what is live, what is in progress, and how it got here.
 * Every change starts from "Edit", which opens (or continues) a draft
 * on its own screen. */
export function TypologyViewScreen() {
  const { code = '' } = useParams();
  const base = useFeatureBasePath();
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite } = useCanWriteTypologies();

  const [detail, setDetail] = useState<TypologyDetail | null>(null);
  const [history, setHistory] = useState<TypologyHistory | null>(null);
  const [metrics, setMetrics] = useState<TypologyRow | null>(null);
  const [killSwitch, setKillSwitch] = useState<KillSwitchScope | null>(null);
  const [killSwitchRequest, setKillSwitchRequest] = useState<KillSwitchAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    Promise.all([getTypology(code), getTypologyHistory(code)])
      .then(([d, h]) => {
        setDetail(d);
        setHistory(h);
      })
      .catch((err: unknown) => setError(errorText(err)));
    listTypologies()
      .then((o) => setMetrics(o.typologies.find((t) => t.typologyCode === code) ?? null))
      .catch(() => setMetrics(null));
    listKillSwitches()
      .then((scopes) => setKillSwitch(scopes.find((k) => k.typologyCode === code) ?? null))
      .catch(() => setKillSwitch(null));
  }, [code]);

  useEffect(load, [load]);

  if (error) return <div className="aml-status aml-status--error">{error}</div>;
  if (!detail || !history) return <div className="aml-status">Loading typology…</div>;

  const { live, draft } = detail;
  const title = live?.typologyLabel ?? draft?.typologyLabel ?? code;

  const edit = async () => {
    if (draft) {
      navigate(`${base}/typologies/${code}/edit`);
      return;
    }
    setBusy(true);
    try {
      await openTypologyDraft(code);
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
          <div className="typology-head__title">
            {title}
            <TypologyStatusBadge status={detail.status} killSwitched={detail.killSwitched} />
          </div>
          <div className="typology-muted">
            {code} · {live ? `v${live.version} live` : 'never promoted'} · created by {detail.createdBy}, {formatDate(detail.createdAt)}
          </div>
        </div>
        {canWrite && (
          <div className="typology-head__actions">
            <button className="aml-btn aml-btn--primary" disabled={busy} onClick={() => void edit()}>
              {draft ? `Continue draft v${draft.version}` : 'Edit — open a draft'}
            </button>
            {killSwitch ? (
              <button className="aml-btn" onClick={() => setKillSwitchRequest({ action: 'reactivate', target: killSwitch })}>
                Reactivate…
              </button>
            ) : (
              <button className="aml-btn typology-danger" onClick={() => setKillSwitchRequest({ action: 'disable', typologyCode: code, typologyLabel: title })}>
                Disable now…
              </button>
            )}
          </div>
        )}
      </div>

      {killSwitch && (
        <div className="typology-banner typology-banner--alert">
          Kill switch on since {new Date(killSwitch.disabledAt).toLocaleString()} ({killSwitch.disabledBy}): “{killSwitch.reason}”. Excluded from
          the agent’s catalog regardless of version.
        </div>
      )}
      {draft && (
        <div className="typology-banner">
          Draft v{draft.version} in progress — not affecting live detection.{' '}
          {canWrite && <Link to={`${base}/typologies/${code}/edit`}>Continue editing →</Link>}
        </div>
      )}
      {detail.status === 'not_live' && !draft && (
        <div className="typology-banner typology-banner--muted">Never promoted and no draft open — the agent has never seen this typology.</div>
      )}
      {detail.status === 'retired' && (
        <div className="typology-banner typology-banner--muted">Retired — not offered to the agent. History and past matches are kept.</div>
      )}

      <div className="typology-scroll">
        <div className="typology-grid">
          <div className="typology-grid__main">
            <VersionTile
              kind="live"
              title={live ? `Live — v${live.version}` : 'Not live'}
              note={live ? (live.active ? 'What the Pattern Matching Agent uses on every alert' : 'Retired') : undefined}
            >
              {live ? <VersionContent version={live} /> : <div className="typology-muted">Nothing has been promoted yet.</div>}
            </VersionTile>

            {draft && (
              <VersionTile
                kind="draft"
                title={`Draft — v${draft.version}`}
                note="Not live"
                actions={
                  canWrite && (
                    <Link className="aml-btn" to={`${base}/typologies/${code}/edit`}>
                      Edit draft
                    </Link>
                  )
                }
              >
                {live ? <VersionDiff older={live} newer={draft} /> : <VersionContent version={draft} />}
                <div className="typology-muted" style={{ marginTop: 8 }}>
                  Regression: {detail.regression ? <RegressionSummary run={detail.regression} /> : 'not run yet'}
                </div>
              </VersionTile>
            )}

            <HistoryTile code={code} base={base} history={history} productionVersion={detail.productionVersion} />
          </div>

          <div className="typology-grid__side">
            <Tile title="Last 30 days">
              {metrics ? (
                <div className="typology-metrics">
                  <div>
                    <div className="aml-label">Alerts</div>
                    <div className="typology-metrics__value">{metrics.alertVolume30d}</div>
                  </div>
                  <div>
                    <div className="aml-label">STR conversion</div>
                    <div className="typology-metrics__value">{(metrics.strConversionRate * 100).toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="aml-label">False positive</div>
                    <div className="typology-metrics__value">{(metrics.falsePositiveRate * 100).toFixed(1)}%</div>
                  </div>
                </div>
              ) : (
                <div className="typology-muted">—</div>
              )}
            </Tile>

            <Tile title="Latest backtest">
              {detail.latestBacktest ? (
                <div style={{ fontSize: 12.5 }}>
                  <div>
                    {detail.latestBacktest.status} · {formatDate(detail.latestBacktest.startedAt)}
                  </div>
                  {detail.latestBacktest.comparisonReport && (
                    <div className="typology-muted" style={{ marginTop: 4 }}>
                      Agreement rate{' '}
                      {detail.latestBacktest.comparisonReport.productionAgreementRate !== null
                        ? `${(detail.latestBacktest.comparisonReport.productionAgreementRate * 100).toFixed(0)}%`
                        : 'n/a'}{' '}
                      over {detail.latestBacktest.comparisonReport.sampleSize} dispositions
                    </div>
                  )}
                </div>
              ) : (
                <div className="typology-muted">None run.</div>
              )}
            </Tile>

            <Tile title="Golden dataset">
              <div style={{ fontSize: 12.5 }}>
                {detail.goldenCoverage > 0
                  ? `${detail.goldenCoverage} golden case(s) expect this typology.`
                  : 'No golden case expects this typology — regressions can only show the other typologies are undisturbed.'}
              </div>
            </Tile>
          </div>
        </div>
      </div>

      {killSwitchRequest && (
        <KillSwitchDialog
          request={killSwitchRequest}
          onCancel={() => setKillSwitchRequest(null)}
          onDone={() => {
            setKillSwitchRequest(null);
            load();
          }}
        />
      )}
    </div>
  );
}
