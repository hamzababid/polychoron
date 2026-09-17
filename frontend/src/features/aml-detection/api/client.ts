import { apiFetch } from '../../../auth/apiClient';
import type {
  ActivityLogEntry,
  AlertQueueRow,
  CaseDetail,
  CaseStatus,
  DashboardSummary,
  DispositionType,
  FilingDetail,
  FilingDraftResponse,
  FilingSummary,
  Paginated,
  RiskTier,
  StrFieldsDraft,
} from './types';

const BASE = '/features/aml_detection';

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
