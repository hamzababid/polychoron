import { apiFetch, getSessionId } from '../../../auth/apiClient';
import type {
  ActivityLogEntry,
  AlertQueueRow,
  BacktestJob,
  CaseDetail,
  CaseStatus,
  ConsistencyResponse,
  Customer360Response,
  DashboardSummary,
  DashboardTrends,
  DataLineageResponse,
  DispositionType,
  EvalRunsResponse,
  FairnessFlagsResponse,
  FilingDetail,
  FilingDraftResponse,
  FilingSummary,
  GuardrailViolationsResponse,
  KillSwitchScope,
  IngestionJobStatus,
  ModelVersionsResponse,
  Paginated,
  RegulatoryChunkRow,
  RegulatoryDocumentRow,
  ReportHistoryEntry,
  ReportingBreakdownBy,
  ReportingSummary,
  RiskTier,
  SamplingOverview,
  SamplingReviewRow,
  StrFieldsDraft,
  TypologyConfigVersion,
  TypologyConsoleOverview,
  TypologyPromotion,
  TypologyRow,
} from './types';

const BASE = '/features/aml_detection';

export function searchCases(q: string) {
  return apiFetch<AlertQueueRow[]>(`${BASE}/search?q=${encodeURIComponent(q)}`);
}

export function listAlerts(params: { status?: CaseStatus; riskTier?: RiskTier; page?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.riskTier) query.set('risk_tier', params.riskTier);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<Paginated<AlertQueueRow>>(`${BASE}/alerts${qs ? `?${qs}` : ''}`);
}

export function claimAlert(caseId: string) {
  return apiFetch<{ caseId: string; assignedAnalystId: string }>(`${BASE}/alerts/${caseId}/claim`, { method: 'POST' });
}

export function getCase(caseId: string) {
  return apiFetch<CaseDetail>(`${BASE}/cases/${caseId}`);
}

export function getActivityLog(caseId: string) {
  return apiFetch<ActivityLogEntry[]>(`${BASE}/cases/${caseId}/activity-log`);
}

export interface RecordDispositionBody {
  officer_id: string;
  disposition_type: DispositionType;
  officer_notes: string;
  overrides_agent_recommendation?: boolean;
  override_reason?: string;
}

export function recordDisposition(caseId: string, body: RecordDispositionBody) {
  return apiFetch<{ caseId: string; status: CaseStatus }>(`${BASE}/cases/${caseId}/disposition`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function getFilingDraft(caseId: string) {
  return apiFetch<FilingDraftResponse>(`${BASE}/cases/${caseId}/filing-draft`);
}

export interface AttestFilingBody {
  officer_id: string;
  officer_name: string;
  officer_role: string;
  tipping_off_checklist_complete: boolean;
  attestation_confirmed: boolean;
  payload?: StrFieldsDraft;
  final_narrative?: string;
}

export function attestFiling(caseId: string, body: AttestFilingBody) {
  return apiFetch<FilingDraftResponse>(`${BASE}/cases/${caseId}/filing/attest`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function submitFiling(caseId: string) {
  return apiFetch<FilingDraftResponse>(`${BASE}/cases/${caseId}/filing/submit`, { method: 'POST' });
}

export function listFilings(params: { page?: number; pageSize?: number }) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<Paginated<FilingSummary>>(`${BASE}/filings${qs ? `?${qs}` : ''}`);
}

export function getFilingDetail(filingId: string) {
  return apiFetch<FilingDetail>(`${BASE}/filings/${filingId}`);
}

export function simulateAcknowledgment(filingId: string) {
  return apiFetch<FilingSummary>(`${BASE}/filings/${filingId}/simulate-acknowledgment`, { method: 'POST' });
}

export function addFollowup(filingId: string, note: string, createdBy: string) {
  return apiFetch<{ followupId: string }>(`${BASE}/filings/${filingId}/followups`, {
    method: 'POST',
    body: JSON.stringify({ note, created_by: createdBy }),
  });
}

export function getDashboardSummary() {
  return apiFetch<DashboardSummary>(`${BASE}/reports/summary-basic`);
}

export function getDashboardTrends() {
  return apiFetch<DashboardTrends>(`${BASE}/reports/summary-trends`);
}

export function listTypologies() {
  return apiFetch<TypologyConsoleOverview>(`${BASE}/typologies`);
}

export function getTypologyHistory(code: string) {
  return apiFetch<TypologyConfigVersion[]>(`${BASE}/typologies/${code}/history`);
}

export function updateTypology(
  code: string,
  body: { rule_logic_description?: string; active?: boolean; change_reason: string; changed_by: string },
) {
  return apiFetch<TypologyRow>(`${BASE}/typologies/${code}`, { method: 'POST', body: JSON.stringify(body) });
}

export function startTypologyBacktest(code: string) {
  return apiFetch<BacktestJob>(`${BASE}/typologies/${code}/backtest`, { method: 'POST' });
}

export function getBacktestJob(jobId: string) {
  return apiFetch<BacktestJob>(`${BASE}/typologies/backtest-jobs/${jobId}`);
}

export function promoteTypology(code: string, body: { backtest_job_id?: string; reason: string; promoted_by: string }) {
  return apiFetch<TypologyPromotion>(`${BASE}/typologies/${code}/promote`, { method: 'POST', body: JSON.stringify(body) });
}

export function getCustomer360(customerId: string) {
  return apiFetch<Customer360Response>(`${BASE}/customers/${customerId}/360`);
}

export function getSamplingOverview(params: { pendingPage?: number; pendingPageSize?: number; reviewedPage?: number; reviewedPageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.pendingPage) query.set('pending_page', String(params.pendingPage));
  if (params.pendingPageSize) query.set('pending_page_size', String(params.pendingPageSize));
  if (params.reviewedPage) query.set('reviewed_page', String(params.reviewedPage));
  if (params.reviewedPageSize) query.set('reviewed_page_size', String(params.reviewedPageSize));
  const qs = query.toString();
  return apiFetch<SamplingOverview>(`${BASE}/governance/sampling${qs ? `?${qs}` : ''}`);
}

export function recordSamplingReview(caseId: string, body: { reviewer_id: string; reviewer_agreed: boolean; reviewer_notes?: string }) {
  return apiFetch<SamplingReviewRow>(`${BASE}/governance/sampling/${caseId}/review`, { method: 'POST', body: JSON.stringify(body) });
}

export function getConsistency(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<ConsistencyResponse>(`${BASE}/governance/consistency${qs ? `?${qs}` : ''}`);
}

export function getModelVersions(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<ModelVersionsResponse>(`${BASE}/governance/model-versions${qs ? `?${qs}` : ''}`);
}

export function getDataLineage() {
  return apiFetch<DataLineageResponse>(`${BASE}/governance/data-lineage`);
}

// ADDITIVE (specs/platform/11-evals-and-guardrails-framework.md)

export function getEvalRuns(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<EvalRunsResponse>(`${BASE}/governance/eval-runs${qs ? `?${qs}` : ''}`);
}

export function getFairnessFlags(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<FairnessFlagsResponse>(`${BASE}/governance/fairness-flags${qs ? `?${qs}` : ''}`);
}

export function getGuardrailViolations(params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<GuardrailViolationsResponse>(`${BASE}/governance/guardrail-violations${qs ? `?${qs}` : ''}`);
}

export function listKillSwitches() {
  return apiFetch<KillSwitchScope[]>(`${BASE}/kill-switch`);
}

export function disableKillSwitch(body: { typology_code?: string; reason: string; disabled_by: string }) {
  return apiFetch<KillSwitchScope>(`${BASE}/kill-switch`, { method: 'POST', body: JSON.stringify(body) });
}

export function reactivateKillSwitch(scopeId: string, reactivatedBy: string) {
  return apiFetch<KillSwitchScope>(`${BASE}/kill-switch/${scopeId}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({ reactivated_by: reactivatedBy }),
  });
}

// ADDITIVE (specs/platform/10-regulatory-knowledge-base-spec.md's
// deferred management screen)

export function listRegulatoryDocuments() {
  return apiFetch<RegulatoryDocumentRow[]>(`${BASE}/regulatory-kb/documents`);
}

export function listRegulatoryChunks(documentId: string) {
  return apiFetch<RegulatoryChunkRow[]>(`${BASE}/regulatory-kb/documents/${documentId}/chunks`);
}

export function ingestRegulatoryDocument(body: {
  title: string;
  source_type: string;
  issuing_authority: string;
  version_label: string;
  source_url?: string;
  ingested_by: string;
  chunks: { section_reference: string; text: string }[];
  supersedes_document_id?: string;
}) {
  return apiFetch<{ jobId: string }>(`${BASE}/regulatory-kb/documents`, { method: 'POST', body: JSON.stringify(body) });
}

export function reembedRegulatoryDocument(documentId: string) {
  return apiFetch<{ jobId: string }>(`${BASE}/regulatory-kb/documents/${documentId}/reembed`, { method: 'POST' });
}

export function getIngestionJobStatus(jobId: string) {
  return apiFetch<IngestionJobStatus>(`${BASE}/regulatory-kb/ingestion-jobs/${jobId}`);
}

export function getReportingSummary(params: {
  periodStart: string;
  periodEnd: string;
  comparePrevious?: boolean;
  breakdownBy?: ReportingBreakdownBy;
}) {
  const query = new URLSearchParams();
  query.set('period_start', params.periodStart);
  query.set('period_end', params.periodEnd);
  if (params.comparePrevious) query.set('compare_previous', 'true');
  if (params.breakdownBy) query.set('breakdown_by', params.breakdownBy);
  return apiFetch<ReportingSummary>(`${BASE}/reports/summary?${query.toString()}`);
}

export function generateReport(body: {
  report_name: string;
  period_start: string;
  period_end: string;
  compare_previous?: boolean;
  breakdown_by?: ReportingBreakdownBy;
  format: 'csv';
  generated_by: string;
}) {
  return apiFetch<ReportHistoryEntry>(`${BASE}/reports/generate`, { method: 'POST', body: JSON.stringify(body) });
}

export function listReportHistory() {
  return apiFetch<ReportHistoryEntry[]>(`${BASE}/reports/history`);
}

/** Not apiFetch — this is a binary file response, not JSON. Fetches
 * the CSV as a blob (still attaching the session header, same as
 * every other call) and triggers a normal browser download via a
 * throwaway anchor element. */
export async function downloadReport(reportId: string, fileName: string): Promise<void> {
  const sessionId = getSessionId();
  const headers = new Headers();
  if (sessionId) headers.set('x-session-id', sessionId);
  const res = await fetch(`/api/v1${BASE}/reports/${reportId}/download`, { headers });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
