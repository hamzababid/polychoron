// Mirrors app-api's AML Detection screen-facing response shapes.

export type RiskTier = 'critical' | 'high' | 'medium' | 'low';
export type CaseStatus = 'open' | 'claimed' | 'investigating' | 'cleared' | 'escalated' | 'pending_filing' | 'filed';
export type AgentRecommendation = 'clear' | 'escalate' | 'recommend_str' | 'recommend_ctr';
export type DispositionType = 'clear' | 'enhanced_monitoring' | 'escalate_senior' | 'file_str' | 'file_ctr';
export type FilingSubmissionStatus = 'draft' | 'submitted' | 'acknowledged' | 'feedback_received' | 'not_yet_drafted';

export interface AlertQueueRow {
  caseId: string;
  sourceAlertId: string;
  customerId: string;
  customerName: string | null;
  accountIds: string[];
  ruleFired: string;
  status: CaseStatus;
  riskScore: number | null;
  recommendation: AgentRecommendation | null;
  recommendationConfidence: number | null;
  narrativeSummary: string | null;
  typologyCode: string | null;
  typologyLabel: string | null;
  assignedAnalystId: string | null;
  assignedAnalystName: string | null;
  createdAt: string;
  slaTargetHours: number | null;
  slaRemainingHours: number | null;
  pastSla: boolean;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface KYCSnapshot {
  customer_name: string;
  cnic: string;
  declared_occupation: string;
  declared_monthly_turnover: number | null;
  kyc_risk_rating: RiskTier;
  account_opening_date: string;
  address: string;
}

export interface TransactionRecord {
  txn_ref: string;
  amount: number;
  currency: string;
  channel: string;
  timestamp: string;
  counterparty_account: string | null;
  branch_code: string | null;
}

export interface LinkedEntity {
  entity_id: string;
  relationship_type: string;
  account_id: string | null;
  notes: string | null;
}

export interface PriorCaseSummary {
  case_id: string;
  typology: string;
  opened_at: string;
  closed_at: string | null;
  final_disposition: DispositionType | null;
}

export interface ScreeningResult {
  list_source: string;
  matched_name: string;
  match_confidence: number;
  match_rationale: string;
  disposition: string | null;
}

export interface EvidenceBundleRow {
  case_id: string;
  kyc: KYCSnapshot;
  transaction_timeline: TransactionRecord[];
  linked_entities: LinkedEntity[];
  prior_cases: PriorCaseSummary[];
  screening_results: ScreeningResult[];
  assembled_at: string;
  agent_version: string;
}

export interface MatchedIndicator {
  indicator_code: string;
  indicator_description: string;
  contributing_evidence: string;
}

export interface TypologyMatchRow {
  case_id: string;
  typology_code: string;
  typology_label: string;
  confidence: number;
  matched_indicators: MatchedIndicator[];
  plain_language_rationale: string;
  matched_at: string;
  agent_version: string;
}

export interface StrFieldsDraft {
  party_name: string;
  party_cnic: string;
  party_address: string;
  party_occupation: string;
  account_ids: string[];
  transaction_refs: string[];
  total_amount: number;
  currency: string;
  typology_tag: string;
  reporting_entity: string;
}

export interface CaseAssessmentRow {
  case_id: string;
  risk_score: number;
  recommendation: AgentRecommendation;
  recommendation_confidence: number;
  draft_narrative: string;
  str_fields_draft: StrFieldsDraft | null;
  assessed_at: string;
  agent_version: string;
}

export interface DispositionRow {
  case_id: string;
  officer_id: string;
  disposition_type: DispositionType;
  officer_notes: string;
  overrides_agent_recommendation: boolean;
  override_reason: string | null;
  decided_at: string;
}

export interface FilingRow {
  filing_id: string;
  case_id: string;
  report_type: string;
  payload: StrFieldsDraft;
  final_narrative: string;
  attestation: Record<string, unknown>;
  submission_status: FilingSubmissionStatus;
  goaml_reference: string | null;
  submitted_at: string | null;
  acknowledged_at: string | null;
  retention_expiry: string | null;
}

export interface CaseDetail {
  caseId: string;
  tenantId: string;
  alert: { source_alert_id: string; customer_id: string; account_ids: string[]; rule_fired: string };
  status: CaseStatus;
  assignedAnalystId: string | null;
  createdAt: string;
  closedAt: string | null;
  evidence: EvidenceBundleRow | null;
  typologyMatch: TypologyMatchRow | null;
  assessment: CaseAssessmentRow | null;
  disposition: DispositionRow | null;
  filing: FilingRow | null;
}

export interface ActivityLogEntry {
  logId: string;
  agentName: string;
  agentVersion: string;
  modelProvider: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  confidence: number | null;
  latencyMs: number;
  dataSourcesQueried: string[];
  timestamp: string;
}

export interface FilingDraftResponse {
  caseId: string;
  riskScore: number;
  recommendation: string;
  strFieldsDraft: StrFieldsDraft;
  narrative: string;
  submissionStatus: FilingSubmissionStatus;
  goamlReference: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
}

export interface FilingSummary {
  filingId: string;
  caseId: string;
  reportType: string;
  submissionStatus: FilingSubmissionStatus;
  goamlReference: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  retentionExpiry: string | null;
  retentionReviewDue: boolean;
}

export interface FilingDetail extends FilingSummary {
  payload: Record<string, unknown>;
  finalNarrative: string;
  followups: Array<{ followupId: string; note: string; createdBy: string; createdAt: string }>;
}

export interface DashboardSummary {
  openAlertsByTier: Record<RiskTier, number>;
  strCtrVolumeThisPeriod: { str: number; ctr: number };
  agingAlertsCount: number;
  agentVsHumanOverrideRate: number;
  branchRiskHeatmap: Array<{ branchCode: string; riskTier: RiskTier; openCaseCount: number }>;
}

export interface MonthlyTrendPoint {
  month: string;
  alertsRaised: number;
  strFiled: number;
  strConversionRate: number;
  falsePositiveRate: number;
}

export interface DispositionBreakdown {
  totalDispositioned: number;
  agreedWithAgent: number;
  overrodeAgent: number;
}

export interface AgingAlertSummary {
  caseId: string;
  sourceAlertId: string;
  customerName: string | null;
  riskScore: number | null;
  slaRemainingHours: number | null;
  typologyLabel: string | null;
  assignedAnalystName: string | null;
}

export interface DashboardTrends {
  monthlyTrend: MonthlyTrendPoint[];
  dispositionBreakdown: DispositionBreakdown;
  mostAgingAlerts: AgingAlertSummary[];
}

export interface TypologyRow {
  typologyCode: string;
  typologyLabel: string;
  ruleLogicDescription: string;
  active: boolean;
  productionVersion: number;
  alertVolume30d: number;
  strConversionRate: number;
  falsePositiveRate: number;
  hasActiveBacktest: boolean;
}

export interface LastPromotion {
  typologyCode: string;
  typologyLabel: string;
  promotedVersion: number;
  promotedBy: string;
  promotedAt: string;
}

export interface TypologyConsoleOverview {
  typologies: TypologyRow[];
  lastPromotion: LastPromotion | null;
}

export interface TypologyConfigVersion {
  versionId: string;
  typologyCode: string;
  version: number;
  ruleLogicDescription: string;
  active: boolean;
  changedBy: string;
  changedAt: string;
  changeReason: string;
}

export type BacktestJobStatus = 'queued' | 'running' | 'complete' | 'failed';

export interface BacktestJob {
  jobId: string;
  typologyCode: string;
  status: BacktestJobStatus;
  startedAt: string;
  completedAt: string | null;
  comparisonReport: {
    method: string;
    sampleSize: number;
    productionAgreementRate: number | null;
    computedAt: string;
  } | null;
}

export interface TypologyPromotion {
  promotionId: string;
  typologyCode: string;
  promotedVersion: number;
  backtestJobId: string | null;
  promotedBy: string;
  promotedAt: string;
}

export interface Customer360Account {
  accountId: string;
  caseIds: string[];
}

export interface Customer360PriorCase {
  caseId: string;
  typologyLabel: string | null;
  openedAt: string;
  closedAt: string | null;
  finalDisposition: DispositionType | null;
}

export interface Customer360ScreeningEntry extends ScreeningResult {
  caseId: string;
  assembledAt: string;
}

export interface PendingSamplingCase {
  caseId: string;
  dispositionType: DispositionType;
  dispositionedAt: string;
}

export interface SamplingReviewRow {
  reviewId: string;
  caseId: string;
  originalDisposition: string;
  reviewerId: string;
  reviewerAgreed: boolean;
  reviewerNotes: string | null;
  reviewedAt: string;
}

export interface SamplingAgreementTrendPoint {
  month: string;
  sampleSize: number;
  agreementRate: number | null;
}

export interface SamplingOverview {
  asOf: string;
  totalClearedDispositions: number;
  totalSampled: number;
  percentOfClearedSampled: number;
  agreementRateTrend: SamplingAgreementTrendPoint[];
  pendingReview: Paginated<PendingSamplingCase>;
  recentReviews: Paginated<SamplingReviewRow>;
}

export interface ConsistencyRow {
  typologyCode: string;
  typologyLabel: string;
  branchCode: string;
  strConversionRate: number;
  sampleSize: number;
  deviationFromTypologyMean: number;
  withinTolerance: boolean;
}

export interface ConsistencyResponse {
  asOf: string;
  toleranceLabel: string;
  rows: Paginated<ConsistencyRow>;
}

export interface ModelVersionCurrent {
  agentName: string;
  agentVersion: string;
  modelProvider: string;
  lastInvokedAt: string;
}

export interface ModelVersionHistoryEntry {
  agentName: string;
  agentVersion: string;
  firstSeenAt: string;
  lastSeenAt: string;
  invocationCount: number;
}

export interface ModelVersionsResponse {
  asOf: string;
  current: ModelVersionCurrent[];
  history: Paginated<ModelVersionHistoryEntry>;
}

export type LineageStatus = 'observed' | 'not_yet_observed' | 'stale';

export interface DataLineageEntry {
  system: string;
  label: string;
  usedFor: string;
  cadence: string;
  status: LineageStatus;
  lastRefreshAt: string | null;
}

export interface DataLineageResponse {
  asOf: string;
  entries: DataLineageEntry[];
}

export interface Customer360Response {
  customerId: string;
  kyc: KYCSnapshot | null;
  currentRiskScore: number | null;
  filingsCount: number;
  accounts: Customer360Account[];
  priorCases: Customer360PriorCase[];
  linkedEntities: LinkedEntity[];
  screeningHistory: Customer360ScreeningEntry[];
}
