import { ApiError, apiFetch, getSessionId } from '../../../auth/apiClient';
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
  ChunkingConfig,
  ChunkingProfile,
  DraftChunksResult,
  RegulatoryChunkRow,
  RegulatoryCitationRow,
  RegulatoryCompareResult,
  RegulatoryDocumentChange,
  RegulatoryDocumentDetail,
  RegulatoryDocumentPage,
  RegulatoryDocumentRow,
  RegulatoryDocumentStatus,
  RegulatoryMetadataInput,
  RegulatorySourceMethod,
  RetrievalPreviewResult,
  SourceSummary,
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

// Regulatory Knowledge Base — api-contracts-phase2.md "Regulatory Knowledge Base".
// Every write is an awaited command (responds immediately); only
// embedding returns a jobId.

const KB = `${BASE}/regulatory-kb`;

export function listRegulatoryDocuments(params: {
  status?: RegulatoryDocumentStatus[];
  sourceType?: string;
  issuingAuthority?: string;
  tag?: string;
  q?: string;
  page?: number;
  pageSize?: number;
}) {
  const query = new URLSearchParams();
  if (params.status?.length) query.set('status', params.status.join(','));
  if (params.sourceType) query.set('source_type', params.sourceType);
  if (params.issuingAuthority) query.set('issuing_authority', params.issuingAuthority);
  if (params.tag) query.set('tag', params.tag);
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', String(params.page));
  if (params.pageSize) query.set('page_size', String(params.pageSize));
  const qs = query.toString();
  return apiFetch<RegulatoryDocumentPage>(`${KB}/documents${qs ? `?${qs}` : ''}`);
}

export function getRegulatoryDocument(documentId: string) {
  return apiFetch<RegulatoryDocumentDetail>(`${KB}/documents/${documentId}`);
}

export function listRegulatoryChunks(documentId: string, q?: string) {
  return apiFetch<RegulatoryChunkRow[]>(`${KB}/documents/${documentId}/chunks${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}

export function listRegulatoryVersions(documentId: string) {
  return apiFetch<RegulatoryDocumentRow[]>(`${KB}/documents/${documentId}/versions`);
}

export function listRegulatoryChanges(documentId: string) {
  return apiFetch<RegulatoryDocumentChange[]>(`${KB}/documents/${documentId}/changes`);
}

export function listRegulatoryCitations(documentId: string, page = 1, pageSize = 10) {
  return apiFetch<{ total: number; page: number; pageSize: number; items: RegulatoryCitationRow[] }>(
    `${KB}/documents/${documentId}/citations?page=${page}&page_size=${pageSize}`,
  );
}

export function compareRegulatoryVersions(documentId: string, otherId: string) {
  return apiFetch<RegulatoryCompareResult>(`${KB}/documents/${documentId}/compare/${otherId}`);
}

export function getRegulatorySourceText(documentId: string) {
  return apiFetch<{ text: string | null }>(`${KB}/documents/${documentId}/source-text`);
}

export function listChunkingProfiles() {
  return apiFetch<ChunkingProfile[]>(`${KB}/chunking-profiles`);
}

export function createChunkingProfile(name: string, config: ChunkingConfig) {
  return apiFetch<{ profile_id: string }>(`${KB}/chunking-profiles`, { method: 'POST', body: JSON.stringify({ name, config }) });
}

export function listIssuingAuthorities() {
  return apiFetch<string[]>(`${KB}/issuing-authorities`);
}

export function createRegulatoryDraft(body: {
  source_method: RegulatorySourceMethod;
  supersedes_document_id?: string;
  copy_chunks?: boolean;
  metadata?: RegulatoryMetadataInput;
}) {
  return apiFetch<{ document_id: string }>(`${KB}/drafts`, { method: 'POST', body: JSON.stringify(body) });
}

export function updateRegulatoryDraft(documentId: string, body: RegulatoryMetadataInput & { chunking_config?: ChunkingConfig }) {
  return apiFetch<{ document_id: string }>(`${KB}/drafts/${documentId}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function setRegulatorySourceText(documentId: string, text: string) {
  return apiFetch<SourceSummary>(`${KB}/drafts/${documentId}/source-text`, { method: 'POST', body: JSON.stringify({ text }) });
}

export function fetchRegulatorySourceUrl(documentId: string, url: string) {
  return apiFetch<SourceSummary>(`${KB}/drafts/${documentId}/source-url`, { method: 'POST', body: JSON.stringify({ url }) });
}

/** Multipart — apiFetch always sends JSON, so this sets its own headers. */
export async function uploadRegulatorySourceFile(documentId: string, file: File): Promise<SourceSummary> {
  const form = new FormData();
  form.append('file', file);
  const headers = new Headers();
  const sessionId = getSessionId();
  if (sessionId) headers.set('x-session-id', sessionId);
  const res = await fetch(`/api/v1${KB}/drafts/${documentId}/source-file`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    let message = `Upload failed: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string | string[] };
      if (body.message) message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
    } catch {
      // keep the generic message
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as SourceSummary;
}

export function previewRegulatoryChunks(documentId: string, chunkingConfig: ChunkingConfig) {
  return apiFetch<DraftChunksResult>(`${KB}/drafts/${documentId}/chunk-preview`, {
    method: 'POST',
    body: JSON.stringify({ chunking_config: chunkingConfig }),
  });
}

export function saveRegulatoryChunks(documentId: string, chunks: { section_reference: string; text: string }[]) {
  return apiFetch<DraftChunksResult>(`${KB}/drafts/${documentId}/chunks`, { method: 'PUT', body: JSON.stringify({ chunks }) });
}

export function acknowledgeRegulatoryInjection(documentId: string, chunkId: string) {
  return apiFetch<{ chunk_id: string }>(`${KB}/drafts/${documentId}/chunks/${chunkId}/acknowledge-injection`, { method: 'POST' });
}

export function embedRegulatoryDraft(documentId: string) {
  return apiFetch<{ jobId: string }>(`${KB}/drafts/${documentId}/embed`, { method: 'POST' });
}

export function publishRegulatoryDraft(documentId: string) {
  return apiFetch<{ document_id: string; superseded_document_id: string | null }>(`${KB}/drafts/${documentId}/publish`, { method: 'POST' });
}

export function discardRegulatoryDraft(documentId: string) {
  return apiFetch<{ document_id: string }>(`${KB}/drafts/${documentId}`, { method: 'DELETE' });
}

export function correctRegulatoryMetadata(documentId: string, changes: RegulatoryMetadataInput, reason: string) {
  return apiFetch<{ document_id: string; changed_fields: string[] }>(`${KB}/documents/${documentId}/metadata`, {
    method: 'PATCH',
    body: JSON.stringify({ changes, reason }),
  });
}

export function withdrawRegulatoryDocument(documentId: string, reason: string) {
  return apiFetch<{ document_id: string }>(`${KB}/documents/${documentId}/withdraw`, { method: 'POST', body: JSON.stringify({ reason }) });
}

export function reembedRegulatoryDocument(documentId: string) {
  return apiFetch<{ jobId: string }>(`${KB}/documents/${documentId}/reembed`, { method: 'POST' });
}

export function previewRegulatoryRetrieval(body: { query: string; top_k?: number; include_draft_document_id?: string }) {
  return apiFetch<{ results: RetrievalPreviewResult[] }>(`${KB}/retrieval-preview`, { method: 'POST', body: JSON.stringify(body) });
}

export function getRegulatoryJob(jobId: string) {
  return apiFetch<IngestionJobStatus>(`${KB}/jobs/${jobId}`);
}

/** The original uploaded/fetched file, fetched with the session header
 * and handed to the browser as a download. */
export async function downloadRegulatorySourceFile(documentId: string, filename: string): Promise<void> {
  const headers = new Headers();
  const sessionId = getSessionId();
  if (sessionId) headers.set('x-session-id', sessionId);
  const res = await fetch(`/api/v1${KB}/documents/${documentId}/source-file`, { headers });
  if (!res.ok) throw new ApiError(res.status, `Download failed: ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
