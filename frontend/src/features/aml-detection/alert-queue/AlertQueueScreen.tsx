import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { claimAlert, getAlertFacets, getDashboardSummary, listAlerts } from '../api/client';
import type { AgentState, AlertQueueFacets, AlertQueueQuery, AlertQueueRow, AlertSort, CaseStatus, DashboardSummary, RiskTier } from '../api/types';
import { MultiSelectFilter } from '../shared/MultiSelectFilter';
import { Pagination } from '../shared/Pagination';
import { useFeatureBasePath } from '../useFeatureBasePath';
import { useToast } from '../../../shell/ToastProvider';
import './alert-queue.css';

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 25, 50];
const NEW_ALERT_POLL_MS = 60_000;

const RISK_TIERS: RiskTier[] = ['critical', 'high', 'medium', 'low'];
// Shown in place of a risk score when there isn't one — only
// "processing" means the agent is actually still working.
const AGENT_STATE_LABEL: Record<AgentState, string> = {
  assessed: '—',
  processing: 'processing…',
  stalled: 'agent didn’t finish',
  kill_switch: 'manual review (kill switch)',
  not_run: 'no agent record',
};

const ALL_STATUSES: CaseStatus[] = ['open', 'claimed', 'investigating', 'escalated', 'pending_filing', 'cleared', 'filed'];
// "Open work": every status a case can still be worked in.
const OPEN_STATUSES: CaseStatus[] = ['open', 'claimed', 'investigating', 'escalated', 'pending_filing'];
const TIER_COLOR: Record<RiskTier, string> = {
  critical: 'var(--color-alert)',
  high: 'var(--color-accent-700)',
  medium: 'var(--color-accent-400)',
  low: 'var(--color-neutral-400)',
};

const RECOMMENDATIONS = [
  { value: 'recommend_str', label: 'Recommend STR' },
  { value: 'recommend_ctr', label: 'Recommend CTR' },
  { value: 'escalate', label: 'Escalate' },
  { value: 'clear', label: 'Clear' },
  { value: 'none', label: 'No recommendation' },
];
const AGENT_STATES = [
  { value: 'needs_attention', label: 'Needs attention (stalled / kill switch)' },
  { value: 'processing', label: 'Processing' },
  { value: 'not_run', label: 'No agent record' },
];
const RECEIVED_PRESETS = [
  { value: '', label: 'Received: any time' },
  { value: 'today', label: 'Received: today' },
  { value: '7d', label: 'Received: last 7 days' },
  { value: '30d', label: 'Received: last 30 days' },
  { value: 'custom', label: 'Received: custom range…' },
];

// The first click on a column sorts in the direction people usually
// want for it; a second click reverses.
const DEFAULT_DIR: Record<AlertSort, 'asc' | 'desc'> = { received: 'desc', risk: 'desc', sla: 'asc', customer: 'asc', status: 'asc' };
const SORT_LABEL: Record<AlertSort, string> = { received: 'received', risk: 'risk score', sla: 'SLA deadline', customer: 'customer', status: 'status' };

// URL keys that are filters (views compare these; sort/paging aren't part of a view).
const FILTER_KEYS = ['q', 'status', 'risk_tier', 'typology', 'recommendation', 'assignee', 'received', 'from', 'to', 'sla', 'agent_state'];

const VIEWS: { id: string; label: string; params: Record<string, string> }[] = [
  { id: 'open', label: 'Open work', params: {} },
  { id: 'mine', label: 'My cases', params: { assignee: 'me' } },
  { id: 'unassigned', label: 'Unassigned', params: { assignee: 'unassigned' } },
  { id: 'past_sla', label: 'Past SLA', params: { sla: 'past' } },
  { id: 'attention', label: 'Needs attention', params: { agent_state: 'needs_attention' } },
  { id: 'all', label: 'All cases', params: { status: 'all' } },
];

const humanize = (s: string) => s.replace(/_/g, ' ');

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Received preset / custom dates → ISO bounds, resolved at request time. */
function receivedBounds(received: string, from: string, to: string): { receivedFrom?: string; receivedTo?: string } {
  const now = new Date();
  const daysAgo = (n: number) => startOfDay(new Date(now.getTime() - n * 86_400_000)).toISOString();
  if (received === 'today') return { receivedFrom: startOfDay(now).toISOString() };
  if (received === '7d') return { receivedFrom: daysAgo(6) };
  if (received === '30d') return { receivedFrom: daysAgo(29) };
  if (received === 'custom') {
    const parse = (v: string) => (v ? new Date(`${v}T00:00:00`) : null);
    const f = parse(from);
    const t = parse(to);
    return {
      receivedFrom: f ? f.toISOString() : undefined,
      // Inclusive "to" date → exclusive bound at the next midnight.
      receivedTo: t ? new Date(t.getTime() + 86_400_000).toISOString() : undefined,
    };
  }
  return {};
}

function formatAge(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** specs/suites/bfsi/features/aml-detection/screens/02-alert-queue.md —
 * restyled to the design export's dense data-grid, then (2026-09-27)
 * given enterprise work-queue behaviour: views, multi-select filters,
 * date range, search, sortable columns (newest first by default), all
 * server-side and all in the URL. Order only changes on an explicit
 * action — new arrivals are announced, never inserted (acceptance
 * criteria). Open evidence-incomplete cases stay pinned first under
 * every sort (guardrail G2). */
export function AlertQueueScreen() {
  const navigate = useNavigate();
  const base = useFeatureBasePath();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<AlertQueueRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [facets, setFacets] = useState<AlertQueueFacets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const loadedAt = useRef<string | null>(null);

  const get = (key: string) => searchParams.get(key) ?? '';
  const getList = (key: string) => (get(key) ? get(key).split(',') : []);

  const statusParam = get('status');
  // No status in the URL = the default "Open work"; `all` = no status filter.
  const statusFilter = statusParam === '' ? OPEN_STATUSES : statusParam === 'all' ? [] : (statusParam.split(',') as CaseStatus[]);
  const sort = (get('sort') || 'received') as AlertSort;
  const dir = (get('dir') || DEFAULT_DIR[sort]) as 'asc' | 'desc';
  const page = Number(get('page') || '1');
  const pageSize = Number(get('page_size') || String(DEFAULT_PAGE_SIZE));
  const [searchText, setSearchText] = useState(get('q'));

  // Everything the request depends on, as one stable string.
  const queryKey = searchParams.toString();

  const buildQuery = useCallback((): AlertQueueQuery => {
    const params = new URLSearchParams(queryKey);
    const p = (k: string) => params.get(k) ?? '';
    const pl = (k: string) => (p(k) ? p(k).split(',') : []);
    const st = p('status');
    return {
      q: p('q') || undefined,
      status: st === '' ? OPEN_STATUSES : st === 'all' ? undefined : (st.split(',') as CaseStatus[]),
      riskTier: pl('risk_tier'),
      typology: pl('typology'),
      recommendation: pl('recommendation'),
      assignee: p('assignee') || undefined,
      ...receivedBounds(p('received'), p('from'), p('to')),
      sla: (p('sla') || undefined) as AlertQueueQuery['sla'],
      agentState: pl('agent_state'),
      sort: (p('sort') || 'received') as AlertSort,
      dir: (p('dir') || DEFAULT_DIR[(p('sort') || 'received') as AlertSort]) as 'asc' | 'desc',
      page: Number(p('page') || '1'),
      pageSize: Number(p('page_size') || String(DEFAULT_PAGE_SIZE)),
    };
  }, [queryKey]);

  const load = useCallback(() => {
    setRows(null);
    setNewCount(0);
    loadedAt.current = new Date().toISOString();
    listAlerts(buildQuery())
      .then((res) => {
        setRows(res.items);
        setTotal(res.total);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [buildQuery]);

  useEffect(load, [load]);

  useEffect(() => {
    getDashboardSummary()
      .then(setSummary)
      .catch(() => undefined);
    getAlertFacets()
      .then(setFacets)
      .catch(() => undefined);
  }, []);

  // New arrivals matching the current filters are announced, never
  // inserted — the list only changes when the officer asks.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible' || !loadedAt.current) return;
      listAlerts({ ...buildQuery(), receivedAfter: loadedAt.current, page: 1, pageSize: 1 })
        .then((res) => setNewCount(res.total))
        .catch(() => undefined);
    }, NEW_ALERT_POLL_MS);
    return () => clearInterval(id);
  }, [buildQuery]);

  // Search box → URL, debounced.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchText.trim() || '') !== get('q')) updateParams({ q: searchText.trim() || undefined });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  /** Set/clear URL params. Anything but paging returns to page 1. */
  const updateParams = (changes: Record<string, string | undefined>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!('page' in changes)) next.delete('page');
    setSearchParams(next);
  };
  const setList = (key: string, values: string[]) => updateParams({ [key]: values.length ? values.join(',') : undefined });

  const applyView = (params: Record<string, string>) => {
    const next = new URLSearchParams();
    for (const key of ['sort', 'dir', 'page_size']) if (searchParams.get(key)) next.set(key, searchParams.get(key)!);
    for (const [k, v] of Object.entries(params)) next.set(k, v);
    setSearchText(params.q ?? '');
    setSearchParams(next);
  };
  const currentFilters = Object.fromEntries(FILTER_KEYS.filter((k) => get(k)).map((k) => [k, get(k)]));
  const activeView = VIEWS.find(
    (v) => Object.keys(v.params).length === Object.keys(currentFilters).length && Object.entries(v.params).every(([k, val]) => currentFilters[k] === val),
  );

  const sortBy = (col: AlertSort) => {
    if (sort === col) updateParams({ sort: col, dir: dir === 'asc' ? 'desc' : 'asc' });
    else updateParams({ sort: col, dir: DEFAULT_DIR[col] });
  };

  const handleClaim = async (caseId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setClaiming(caseId);
    try {
      await claimAlert(caseId);
      load();
      toast.success('Alert claimed.');
    } catch (err) {
      // A failed claim shouldn't blow away the whole queue behind it.
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setClaiming(null);
    }
  };

  if (error) return <div className="aml-status aml-status--error">Could not load alert queue: {error}</div>;

  const openTotal = summary ? Object.values(summary.openAlertsByTier).reduce((a, b) => a + b, 0) : null;
  const typologyOptions = [
    ...(facets?.typologies ?? []).map((t) => ({ value: t.code, label: t.label })),
    { value: 'none', label: 'No typology match' },
  ];
  const labelFor = (options: { value: string; label: string }[], v: string) => options.find((o) => o.value === v)?.label ?? humanize(v);
  const assigneeLabel = (v: string) =>
    v === 'me' ? 'me' : v === 'unassigned' ? 'unassigned' : (facets?.assignees.find((a) => a.userId === v)?.name ?? v);

  // Removable chips for every active filter (status only when it
  // differs from the default open work).
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (get('q'))
    chips.push({
      key: 'q',
      label: `Search: “${get('q')}”`,
      clear: () => {
        setSearchText('');
        updateParams({ q: undefined });
      },
    });
  if (statusParam) chips.push({ key: 'status', label: `Status: ${statusParam === 'all' ? 'any' : statusFilter.map(humanize).join(', ')}`, clear: () => updateParams({ status: undefined }) });
  if (get('risk_tier')) chips.push({ key: 'risk_tier', label: `Risk: ${getList('risk_tier').join(', ')}`, clear: () => updateParams({ risk_tier: undefined }) });
  if (get('typology')) chips.push({ key: 'typology', label: `Typology: ${getList('typology').map((v) => labelFor(typologyOptions, v)).join(', ')}`, clear: () => updateParams({ typology: undefined }) });
  if (get('recommendation')) chips.push({ key: 'recommendation', label: `Recommendation: ${getList('recommendation').map((v) => labelFor(RECOMMENDATIONS, v)).join(', ')}`, clear: () => updateParams({ recommendation: undefined }) });
  if (get('assignee')) chips.push({ key: 'assignee', label: `Assignee: ${assigneeLabel(get('assignee'))}`, clear: () => updateParams({ assignee: undefined }) });
  if (get('received'))
    chips.push({
      key: 'received',
      label:
        get('received') === 'custom'
          ? `Received: ${get('from') || '…'} – ${get('to') || '…'}`
          : (RECEIVED_PRESETS.find((r) => r.value === get('received'))?.label ?? ''),
      clear: () => updateParams({ received: undefined, from: undefined, to: undefined }),
    });
  if (get('sla')) chips.push({ key: 'sla', label: get('sla') === 'past' ? 'SLA: past due' : 'SLA: due within 24 h', clear: () => updateParams({ sla: undefined }) });
  if (get('agent_state')) chips.push({ key: 'agent_state', label: `Agent: ${getList('agent_state').map((v) => labelFor(AGENT_STATES, v)).join(', ')}`, clear: () => updateParams({ agent_state: undefined }) });

  const sortHeader = (col: AlertSort, label: string, align?: 'right') => (
    <button
      type="button"
      className={`qsort ${sort === col ? 'qsort--active' : ''}`}
      style={align ? { justifyContent: 'flex-end', width: '100%' } : undefined}
      onClick={() => sortBy(col)}
      aria-sort={sort === col ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="qsort__arrow">{sort === col ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
    </button>
  );

  return (
    <div className="alert-queue">
      {summary && (
        <div className="stripbar">
          <div className="stripbar__cell" style={{ minWidth: 170 }}>
            <div className="aml-label">Open alerts</div>
            <div className="stripbar__big">{openTotal}</div>
          </div>
          <div className="stripbar__cell" style={{ display: 'flex', gap: 20 }}>
            {RISK_TIERS.map((t) => (
              <div key={t}>
                <div className="aml-label" style={{ color: TIER_COLOR[t] }}>
                  {t}
                </div>
                <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18 }}>{summary.openAlertsByTier[t]}</div>
              </div>
            ))}
          </div>
          <div className="stripbar__cell" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="aml-label" style={{ color: summary.agingAlertsCount > 0 ? 'var(--color-alert)' : undefined }}>
              Past SLA
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18, color: summary.agingAlertsCount > 0 ? 'var(--color-alert)' : undefined }}>
              {summary.agingAlertsCount}
            </div>
          </div>
        </div>
      )}

      <div className="alert-queue__views" role="tablist" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={activeView?.id === v.id}
            className={`alert-queue__view ${activeView?.id === v.id ? 'alert-queue__view--active' : ''}`}
            onClick={() => applyView(v.params)}
          >
            {v.label}
          </button>
        ))}
        {!activeView && <span className="alert-queue__view alert-queue__view--custom">Custom filters</span>}
      </div>

      <div className="filterbar">
        <input
          className="input alert-queue__search"
          type="search"
          placeholder="Search alert ID, customer, case ID…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <MultiSelectFilter
          label="Status"
          options={ALL_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
          value={statusParam === 'all' ? [] : statusFilter}
          onChange={(v) => updateParams({ status: v.length ? v.join(',') : 'all' })}
        />
        <MultiSelectFilter
          label="Risk"
          options={[...RISK_TIERS.map((t) => ({ value: t, label: t })), { value: 'unscored', label: 'unscored' }]}
          value={getList('risk_tier')}
          onChange={(v) => setList('risk_tier', v)}
        />
        <MultiSelectFilter label="Typology" options={typologyOptions} value={getList('typology')} onChange={(v) => setList('typology', v)} />
        <MultiSelectFilter label="Recommendation" options={RECOMMENDATIONS} value={getList('recommendation')} onChange={(v) => setList('recommendation', v)} />
        <select value={get('assignee')} onChange={(e) => updateParams({ assignee: e.target.value || undefined })}>
          <option value="">Assignee: anyone</option>
          <option value="me">Assigned to me</option>
          <option value="unassigned">Unassigned</option>
          {facets?.assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={get('received')}
          onChange={(e) => updateParams({ received: e.target.value || undefined, ...(e.target.value !== 'custom' ? { from: undefined, to: undefined } : {}) })}
        >
          {RECEIVED_PRESETS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        {get('received') === 'custom' && (
          <span className="alert-queue__range">
            <input className="input" type="date" aria-label="Received from" value={get('from')} max={get('to') || undefined} onChange={(e) => updateParams({ from: e.target.value || undefined })} />
            –
            <input className="input" type="date" aria-label="Received to" value={get('to')} min={get('from') || undefined} onChange={(e) => updateParams({ to: e.target.value || undefined })} />
          </span>
        )}
        <select value={get('sla')} onChange={(e) => updateParams({ sla: e.target.value || undefined })}>
          <option value="">SLA: any</option>
          <option value="past">SLA: past due</option>
          <option value="due_24h">SLA: due within 24 h</option>
        </select>
        <MultiSelectFilter label="Agent" options={AGENT_STATES} value={getList('agent_state')} onChange={(v) => setList('agent_state', v)} />
      </div>

      {chips.length > 0 && (
        <div className="alert-queue__chips">
          {chips.map((c) => (
            <span key={c.key} className="alert-queue__chip">
              {c.label}
              <button type="button" aria-label={`Remove ${c.label}`} onClick={c.clear}>
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="alert-queue__clearAll"
            onClick={() => {
              setSearchText('');
              applyView({});
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {newCount > 0 && (
        <div className="alert-queue__newBanner" role="status">
          {newCount} new alert{newCount === 1 ? '' : 's'} match{newCount === 1 ? 'es' : ''} these filters since you loaded the list.
          <button type="button" className="aml-btn" onClick={() => (page === 1 ? load() : updateParams({ page: undefined }))}>
            Show
          </button>
        </div>
      )}

      <div className="alert-queue__sortstrip">
        <span className="aml-label" style={{ textTransform: 'none', letterSpacing: 0, color: 'var(--color-neutral-700)' }}>
          {rows ? `${total} ${total === 1 ? 'case' : 'cases'}` : '…'}
          {statusParam === '' && ' · open work'} · sorted by {SORT_LABEL[sort]}, {dir === 'asc' ? 'ascending' : 'descending'} · order changes only when you
          sort, filter or refresh
        </span>
      </div>

      {rows === null ? (
        <div className="aml-status">Loading alert queue…</div>
      ) : rows.length === 0 ? (
        <div className="tile" style={{ margin: 18, padding: 24, textAlign: 'center' }}>
          No alerts match these filters.
        </div>
      ) : (
        <div className="alert-queue__scroll">
          <div className="alert-queue__grid">
            <div className="qrow qrow--head">
              <div className="qcell">{sortHeader('received', 'Received')}</div>
              <div className="qcell">{sortHeader('risk', 'Risk')}</div>
              <div className="qcell">Matched typology</div>
              <div className="qcell">{sortHeader('customer', 'Customer')}</div>
              <div className="qcell">Recommendation</div>
              <div className="qcell">{sortHeader('status', 'Status')}</div>
              <div className="qcell">{sortHeader('sla', 'SLA')}</div>
              <div className="qcell">Assigned</div>
              <div className="qcell" style={{ textAlign: 'right' }}>
                Alert
              </div>
            </div>
            {rows.map((r) => (
              <div
                key={r.caseId}
                className={`qrow${r.pastSla ? ' qrow--pastSla' : ''}${r.pinned ? ' qrow--pinned' : ''}`}
                onClick={() => navigate(`${base}/cases/${r.caseId}`)}
              >
                <div className="qcell">
                  <div className="alert-queue__date">
                    {new Date(r.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                  <div className="alert-queue__time" title={new Date(r.createdAt).toLocaleString()}>
                    {new Date(r.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })} · {formatAge(r.createdAt)}
                  </div>
                </div>
                <div className="qcell">
                  {r.riskScore !== null ? (
                    <span className={`aml-badge ${r.riskScore >= 80 ? 'aml-badge--critical' : r.riskScore >= 50 ? 'aml-badge--high' : ''}`}>{r.riskScore}</span>
                  ) : (
                    <span className={`alert-queue__pending alert-queue__pending--${r.agentState}`}>{AGENT_STATE_LABEL[r.agentState]}</span>
                  )}
                  {r.evidenceIncomplete && (
                    <div className="alert-queue__evidenceFlag" title="The Evidence Gathering Agent couldn't reach every data source (guardrail G2)">
                      evidence incomplete{r.pinned ? ' · pinned' : ''}
                    </div>
                  )}
                </div>
                <div className="qcell">{r.typologyLabel ? <span className="aml-tag">{r.typologyLabel}</span> : '—'}</div>
                <div className="qcell">
                  <div
                    className="alert-queue__customer"
                    style={{ cursor: 'pointer' }}
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`${base}/customers/${r.customerId}`);
                    }}
                  >
                    {r.customerName ?? r.customerId}
                  </div>
                  <div className="alert-queue__account">
                    A/C {r.accountIds.join(', ')}
                    {r.customerName && ` · ${r.customerId}`}
                  </div>
                </div>
                <div className="qcell">
                  {r.recommendation ? (
                    <>
                      <span className="alert-queue__rec">
                        <span className="dot" style={{ background: 'var(--color-accent-800)', marginRight: 5 }} />
                        {humanize(r.recommendation)}
                      </span>
                      {r.recommendationConfidence !== null && <div className="alert-queue__conf">conf. {r.recommendationConfidence.toFixed(2)}</div>}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="qcell">
                  <span className={`alert-queue__status alert-queue__status--${r.status}`}>{humanize(r.status)}</span>
                </div>
                <div className="qcell">
                  {r.slaRemainingHours !== null ? (
                    <>
                      <div className={r.pastSla ? 'alert-queue__sla alert-queue__sla--past' : 'alert-queue__sla'}>
                        {r.pastSla ? `past due ${Math.abs(r.slaRemainingHours).toFixed(1)}h` : `${r.slaRemainingHours.toFixed(1)}h left`}
                      </div>
                      {r.slaTargetHours !== null && (
                        <div className="alert-queue__slaBar">
                          <span
                            style={{
                              width: `${Math.max(0, Math.min(100, (r.slaRemainingHours / r.slaTargetHours) * 100))}%`,
                              background: r.pastSla ? 'var(--color-alert)' : 'var(--color-accent-700)',
                            }}
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    '—'
                  )}
                </div>
                <div className="qcell">
                  {r.assignedAnalystName ? (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span className="alert-queue__avatar">
                        {r.assignedAnalystName
                          .split(/\s+/)
                          .map((w) => w[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      {r.assignedAnalystName}
                    </span>
                  ) : (
                    <button className="aml-btn" disabled={claiming === r.caseId} onClick={(e) => void handleClaim(r.caseId, e)}>
                      {claiming === r.caseId ? 'Claiming…' : 'Claim'}
                    </button>
                  )}
                </div>
                <div className="qcell" style={{ textAlign: 'right' }}>
                  <div className="alert-queue__id">{r.sourceAlertId}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--color-accent-700)' }}>open case →</div>
                </div>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageChange={(p) => updateParams({ page: String(p) })}
            onPageSizeChange={(size) => updateParams({ page_size: String(size) })}
          />
        </div>
      )}
    </div>
  );
}
