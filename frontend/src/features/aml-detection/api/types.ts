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

// ADDITIVE (specs/platform/11-evals-and-guardrails-framework.md)

export interface EvalRunRow {
  runId: string;
  agentVersionUnderTest: string;
  triggeredBy: string;
  startedAt: string;
  completedAt: string | null;
  totalCases: number;
  passed: number;
  failed: number;
  status: 'running' | 'passed' | 'failed' | 'needs_review';
}

export interface EvalRunsResponse {
  asOf: string;
  latestStatus: string | null;
  rows: Paginated<EvalRunRow>;
}

export interface FairnessFlagRow {
  snapshotId: string;
  periodStart: string;
  periodEnd: string;
  segmentDimension: string;
  segmentValue: string;
  strRecommendationRate: number;
  falsePositiveRate: number;
  baselineDeviation: number;
  flagged: boolean;
}

export interface FairnessFlagsResponse {
  asOf: string;
  rows: Paginated<FairnessFlagRow>;
}

export interface GuardrailViolationRow {
  violationId: string;
  externalCaseRef: string;
  guardrailType: string;
  nodeName: string;
  severity: 'blocked' | 'flagged' | 'escalated';
  details: string;
  detectedAt: string;
}

export interface GuardrailViolationsResponse {
  asOf: string;
  rows: Paginated<GuardrailViolationRow>;
}

export interface KillSwitchScope {
  scopeId: string;
  tenantId: string;
  featureCode: string;
  typologyCode: string | null;
  disabledBy: string;
  disabledAt: string;
  reason: string;
  reactivatedAt: string | null;
  reactivatedBy: string | null;
}

// Regulatory Knowledge Base —
// specs/suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md,
// api-contracts-phase2.md "Regulatory Knowledge Base".

export type RegulatorySourceType = 'statute' | 'regulation' | 'circular' | 'guidance' | 'international';
export type RegulatoryDocumentStatus = 'draft' | 'current' | 'superseded' | 'withdrawn';
export type RegulatorySourceMethod = 'upload' | 'paste' | 'url' | 'manual';
export type ChunkingStrategy = 'heading_pattern' | 'paragraph' | 'fixed_size';

export interface ChunkingConfig {
  strategy: ChunkingStrategy;
  heading_pattern?: string | null;
  target_chunk_chars: number;
  max_chunk_chars: number;
  overlap_chars: number;
  min_chunk_chars: number;
  section_reference_mode: 'from_heading' | 'template';
  section_reference_template?: string | null;
  strip_headers_footers: boolean;
}

export interface RegulatoryDocumentRow {
  documentId: string;
  documentFamilyId: string;
  versionNumber: number;
  title: string;
  sourceType: RegulatorySourceType;
  issuingAuthority: string;
  versionLabel: string;
  effectiveDate: string | null;
  status: RegulatoryDocumentStatus;
  supersededBy: string | null;
  sourceUrl: string | null;
  tags: string[];
  ingestedAt: string;
  ingestedBy: string;
  chunkCount: number;
  embeddedCount: number;
  lastChangedAt: string;
}

export interface RegulatoryDocumentPage {
  items: RegulatoryDocumentRow[];
  total: number;
  page: number;
  pageSize: number;
  statusCounts: Record<RegulatoryDocumentStatus, number>;
}

export interface RegulatoryDocumentDetail extends RegulatoryDocumentRow {
  jurisdiction: string;
  language: string;
  relatedTypologyCodes: string[];
  retrievalEnabled: boolean;
  retrievalPriority: number;
  notes: string | null;
  sourceMethod: string;
  chunkingConfig: ChunkingConfig | null;
  publishedBy: string | null;
  publishedAt: string | null;
  withdrawnBy: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  hasExtractedText: boolean;
  unacknowledgedInjectionCount: number;
  sourceFile: {
    fileId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    sha256: string;
    fetchedFromUrl: string | null;
    uploadedAt: string;
  } | null;
  family: { currentDocumentId: string | null; draftDocumentId: string | null; versionCount: number };
}

export interface RegulatoryChunkRow {
  chunkId: string;
  ordinal: number;
  sectionReference: string;
  text: string;
  charCount: number;
  embedded: boolean;
  injectionFlags: string[];
  injectionAcknowledged: boolean;
  citedByCaseCount: number;
  warnings: string[];
}

/** Chunk shape returned by the draft commands (snake_case — straight
 * from agent-service's lifecycle.py). */
export interface DraftChunk {
  chunk_id: string;
  ordinal: number;
  section_reference: string;
  text: string;
  char_count: number;
  embedded: boolean;
  warnings: string[];
  injection_flags: string[];
  injection_acknowledged: boolean;
}

export interface DraftChunksResult {
  chunks: DraftChunk[];
  total_chars: number;
  warning_count: number;
  unacknowledged_injection_count: number;
}

export interface SourceSummary {
  char_count: number;
  page_count: number | null;
  excerpt: string;
}

export interface RegulatoryDocumentChange {
  changeId: string;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string;
  changedAt: string;
  reason: string;
}

export interface RegulatoryCitationRow {
  caseId: string;
  sourceAlertId: string;
  customerId: string;
  caseStatus: string;
  typologyLabel: string;
  matchedAt: string;
  citedSections: string[];
}

export interface RegulatoryCompareResult {
  older: { documentId: string; versionNumber: number; versionLabel: string; status: RegulatoryDocumentStatus; publishedAt: string | null };
  newer: { documentId: string; versionNumber: number; versionLabel: string; status: RegulatoryDocumentStatus; publishedAt: string | null };
  metadata: { field: string; older: unknown; newer: unknown }[];
  chunks: { status: 'added' | 'removed' | 'changed' | 'unchanged'; sectionReference: string; olderText: string | null; newerText: string | null }[];
}

export interface ChunkingProfile {
  profileId: string;
  name: string;
  config: ChunkingConfig;
  createdBy: string;
  createdAt: string;
}

export interface RetrievalPreviewResult {
  chunk_id: string;
  document_id: string;
  document_title: string;
  document_status: RegulatoryDocumentStatus;
  section_reference: string;
  text: string;
  score: number;
}

export interface IngestionJobStatus {
  jobId: string;
  kind: 'embed' | 'reembed' | 'ingest';
  status: 'running' | 'completed' | 'failed';
  progress?: { done: number; total: number };
  documentId?: string;
  chunkCount?: number;
  error?: string;
}

/** Metadata fields a draft PATCH / live correction accepts (snake_case
 * to match the API body). */
export interface RegulatoryMetadataInput {
  title?: string;
  source_type?: RegulatorySourceType;
  issuing_authority?: string;
  version_label?: string;
  effective_date?: string | null;
  source_url?: string | null;
  jurisdiction?: string;
  language?: string;
  tags?: string[];
  related_typology_codes?: string[];
  notes?: string | null;
  retrieval_enabled?: boolean;
  retrieval_priority?: number;
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

export type ReportingBreakdownBy = 'type' | 'typology' | 'branch';

export interface FilingVolumeMonthPoint {
  month: string;
  strCount: number;
  ctrCount: number;
}

export interface FilingBreakdownRow {
  code: string;
  label: string;
  count: number;
  percentOfTotal: number;
}

export interface SlaTierRow {
  tier: RiskTier;
  targetHours: number;
  total: number;
  breached: number;
  adherenceRate: number | null;
  previousAdherenceRate: number | null;
}

export interface ReportingSummary {
  asOf: string;
  periodStart: string;
  periodEnd: string;
  comparePrevious: boolean;
  previousPeriodStart: string | null;
  previousPeriodEnd: string | null;
  strFiledCount: number;
  strFiledPrevCount: number | null;
  ctrFiledCount: number;
  ctrFiledPrevCount: number | null;
  avgTimeToFileHours: number | null;
  avgTimeToFilePrevHours: number | null;
  slaAdherenceOverall: number | null;
  slaAdherenceOverallPrev: number | null;
  slaByTier: SlaTierRow[];
  monthlyFilingVolume: FilingVolumeMonthPoint[];
  breakdownBy: ReportingBreakdownBy;
  breakdown: FilingBreakdownRow[];
  agentWorkload: DispositionBreakdown;
}

export interface ReportHistoryEntry {
  reportId: string;
  reportName: string;
  periodLabel: string;
  format: string;
  fileName: string;
  contentHash: string;
  generatedBy: string;
  generatedAt: string;
}
