import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AmlSamplingReview } from '../entities/aml-sampling-review.entity.js';

const TREND_MONTHS = 6;
// "Simple random-sample selection ... no stratification yet" (TASKS.md)
// — a deterministic pseudo-random selection over case_id, so the
// candidate list is stable across repeated GETs without needing a
// separate "selected" table. Not cryptographic; fine for sample
// selection, not a security boundary.
const SAMPLE_RATE_PERCENT = 20;
// "surface staleness explicitly if any source hasn't refreshed
// recently" (screen spec) — arbitrary but reasonable for a system
// whose demo data doesn't necessarily churn hourly.
const STALE_AFTER_HOURS = 24;

export interface PendingSamplingCase {
  caseId: string;
  dispositionType: string;
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

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
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
  // Deviation from the mean STR conversion rate across branches for
  // this SAME typology — comparing a branch's rate to a different
  // typology's mean wouldn't be a like-for-like consistency check.
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

const FEATURE_CODE = 'aml_detection';
const MOCK_BANK_SOURCES = ['mock_bank.kyc', 'mock_bank.transactions', 'mock_bank.linked_entities'];
// Deviation (in percentage points) from a typology's own cross-branch
// mean beyond which a branch's STR conversion rate is flagged —
// arbitrary but consistent with the Typology Console's own tolerance
// conventions elsewhere in this feature.
const CONSISTENCY_TOLERANCE_POINTS = 10;

/** specs/suites/bfsi/features/aml-detection/screens/09-model-governance-audit.md
 * api-contracts-phase2.md's namespaced contract (the screen spec's own
 * paths are the older, unnamespaced style — same resolution every
 * other Phase 1/2 screen made). RBAC is enforced per-route in the
 * controller, not here — this service has no notion of "who's asking",
 * per the same pattern as TypologyConsoleService. */
@Injectable()
export class ModelGovernanceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlSamplingReview) private readonly samplingReviews: Repository<AmlSamplingReview>,
  ) {}

  async getSamplingOverview(params: {
    pendingPage: number;
    pendingPageSize: number;
    reviewedPage: number;
    reviewedPageSize: number;
  }): Promise<SamplingOverview> {
    const pendingOffset = (params.pendingPage - 1) * params.pendingPageSize;
    const reviewedOffset = (params.reviewedPage - 1) * params.reviewedPageSize;

    const [windowCounts, trendRows, pendingCountRows, pendingRows, recentTotal, recentRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE d.disposition_type = 'clear')::int AS total_cleared,
           count(*) FILTER (WHERE d.disposition_type = 'clear' AND r.review_id IS NOT NULL)::int AS total_sampled
         FROM aml_dispositions d
         JOIN aml_cases c ON c.case_id = d.case_id
         LEFT JOIN aml_sampling_reviews r ON r.case_id = d.case_id
         WHERE c.created_at >= date_trunc('month', now()) - interval '${TREND_MONTHS - 1} months'`,
      ) as Promise<Array<{ total_cleared: number; total_sampled: number }>>,
      this.dataSource.query(
        `SELECT
           to_char(date_trunc('month', reviewed_at), 'YYYY-MM') AS month,
           count(*)::int AS sample_size,
           count(*) FILTER (WHERE reviewer_agreed)::int AS agreed_count
         FROM aml_sampling_reviews
         WHERE reviewed_at >= date_trunc('month', now()) - interval '${TREND_MONTHS - 1} months'
         GROUP BY 1 ORDER BY 1`,
      ) as Promise<Array<{ month: string; sample_size: number; agreed_count: number }>>,
      this.dataSource.query(
        `SELECT count(*)::int AS total
         FROM aml_cases c
         JOIN aml_dispositions d ON d.case_id = c.case_id
         LEFT JOIN aml_sampling_reviews r ON r.case_id = c.case_id
         WHERE d.disposition_type = 'clear'
           AND r.review_id IS NULL
           AND abs(('x' || substr(md5(c.case_id::text), 1, 8))::bit(32)::int) % 100 < $1`,
        [SAMPLE_RATE_PERCENT],
      ) as Promise<Array<{ total: number }>>,
      this.dataSource.query(
        `SELECT c.case_id, d.disposition_type, d.decided_at
         FROM aml_cases c
         JOIN aml_dispositions d ON d.case_id = c.case_id
         LEFT JOIN aml_sampling_reviews r ON r.case_id = c.case_id
         WHERE d.disposition_type = 'clear'
           AND r.review_id IS NULL
           AND abs(('x' || substr(md5(c.case_id::text), 1, 8))::bit(32)::int) % 100 < $1
         ORDER BY d.decided_at DESC
         LIMIT $2 OFFSET $3`,
        [SAMPLE_RATE_PERCENT, params.pendingPageSize, pendingOffset],
      ) as Promise<Array<{ case_id: string; disposition_type: string; decided_at: Date }>>,
      this.samplingReviews.count(),
      this.samplingReviews.find({ order: { reviewedAt: 'DESC' }, take: params.reviewedPageSize, skip: reviewedOffset }),
    ]);

    const { total_cleared: totalCleared, total_sampled: totalSampled } = windowCounts[0] ?? {
      total_cleared: 0,
      total_sampled: 0,
    };

    const trendByMonth = new Map(trendRows.map((r) => [r.month, r]));
    const agreementRateTrend: SamplingAgreementTrendPoint[] = [];
    const cursor = new Date();
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() - (TREND_MONTHS - 1));
    for (let i = 0; i < TREND_MONTHS; i++) {
      const month = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = trendByMonth.get(month);
      const sampleSize = row?.sample_size ?? 0;
      agreementRateTrend.push({
        month,
        sampleSize,
        // null (not 0) when there's nothing sampled that month — a
        // real 0% agreement rate must never be visually
        // indistinguishable from "no data yet".
        agreementRate: sampleSize > 0 ? round3((row?.agreed_count ?? 0) / sampleSize) : null,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    return {
      asOf: new Date().toISOString(),
      totalClearedDispositions: totalCleared,
      totalSampled,
      percentOfClearedSampled: totalCleared > 0 ? round3(totalSampled / totalCleared) : 0,
      agreementRateTrend,
      pendingReview: {
        items: pendingRows.map((r) => ({
          caseId: r.case_id,
          dispositionType: r.disposition_type,
          dispositionedAt: r.decided_at.toISOString(),
        })),
        total: pendingCountRows[0]?.total ?? 0,
        page: params.pendingPage,
        pageSize: params.pendingPageSize,
      },
      recentReviews: {
        items: recentRows.map(toSamplingReviewRow),
        total: recentTotal,
        page: params.reviewedPage,
        pageSize: params.reviewedPageSize,
      },
    };
  }

  async recordReview(caseId: string, dto: { reviewer_id: string; reviewer_agreed: boolean; reviewer_notes?: string }): Promise<SamplingReviewRow> {
    const existing = await this.samplingReviews.findOneBy({ caseId });
    if (existing) {
      throw new BadRequestException(`Case ${caseId} already has a sampling review — one review per case`);
    }

    const dispositionRows = (await this.dataSource.query(
      `SELECT disposition_type FROM aml_dispositions WHERE case_id = $1`,
      [caseId],
    )) as Array<{ disposition_type: string }>;
    if (dispositionRows.length === 0) {
      throw new NotFoundException(`No disposition on file for case_id=${caseId} — nothing to sample-review yet`);
    }

    const saved = await this.samplingReviews.save({
      caseId,
      originalDisposition: dispositionRows[0].disposition_type,
      reviewerId: dto.reviewer_id,
      reviewerAgreed: dto.reviewer_agreed,
      reviewerNotes: dto.reviewer_notes,
    });
    return toSamplingReviewRow(saved);
  }

  async getConsistency(page: number, pageSize: number): Promise<ConsistencyResponse> {
    const rows = (await this.dataSource.query(
      `SELECT
         t.typology_code,
         t.typology_label,
         (e.transaction_timeline -> 0 ->> 'branch_code') AS branch_code,
         count(*) FILTER (WHERE d.disposition_type = 'file_str')::int AS str_count,
         count(*)::int AS total_count
       FROM aml_typology_matches t
       JOIN aml_evidence_bundles e ON e.case_id = t.case_id
       LEFT JOIN aml_dispositions d ON d.case_id = t.case_id
       WHERE (e.transaction_timeline -> 0 ->> 'branch_code') IS NOT NULL
       GROUP BY 1, 2, 3
       ORDER BY 1, 3`,
    )) as Array<{ typology_code: string; typology_label: string; branch_code: string; str_count: number; total_count: number }>;

    const withRates = rows.map((r) => ({
      typologyCode: r.typology_code,
      typologyLabel: r.typology_label,
      branchCode: r.branch_code,
      strConversionRate: r.total_count > 0 ? round3(r.str_count / r.total_count) : 0,
      sampleSize: r.total_count,
    }));

    const meanByTypology = new Map<string, number>();
    for (const code of new Set(withRates.map((r) => r.typologyCode))) {
      const forTypology = withRates.filter((r) => r.typologyCode === code);
      meanByTypology.set(code, forTypology.reduce((sum, r) => sum + r.strConversionRate, 0) / forTypology.length);
    }

    // Deviation/tolerance need the FULL cross-branch set per typology
    // to compute a meaningful mean — paginate only after that's done,
    // never paginate the raw query itself here.
    const enriched = withRates.map((r) => {
      const mean = meanByTypology.get(r.typologyCode) ?? r.strConversionRate;
      const deviationPoints = round3((r.strConversionRate - mean) * 100);
      return {
        ...r,
        deviationFromTypologyMean: deviationPoints,
        withinTolerance: Math.abs(deviationPoints) <= CONSISTENCY_TOLERANCE_POINTS,
      };
    });

    const offset = (page - 1) * pageSize;
    return {
      asOf: new Date().toISOString(),
      toleranceLabel: `±${CONSISTENCY_TOLERANCE_POINTS} points from each typology's own cross-branch mean`,
      rows: { items: enriched.slice(offset, offset + pageSize), total: enriched.length, page, pageSize },
    };
  }

  async getModelVersions(historyPage: number, historyPageSize: number): Promise<ModelVersionsResponse> {
    const historyOffset = (historyPage - 1) * historyPageSize;
    const [currentRows, historyCountRows, historyRows] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT ON (agent_name) agent_name, agent_version, model_provider, "timestamp"
         FROM platform_agent_activity_log
         WHERE feature_code = $1
         ORDER BY agent_name, "timestamp" DESC`,
        [FEATURE_CODE],
      ) as Promise<Array<{ agent_name: string; agent_version: string; model_provider: string; timestamp: Date }>>,
      this.dataSource.query(
        `SELECT count(*)::int AS total FROM (
           SELECT 1 FROM platform_agent_activity_log WHERE feature_code = $1 GROUP BY agent_name, agent_version
         ) x`,
        [FEATURE_CODE],
      ) as Promise<Array<{ total: number }>>,
      this.dataSource.query(
        `SELECT agent_name, agent_version, min("timestamp") AS first_seen, max("timestamp") AS last_seen, count(*)::int AS invocation_count
         FROM platform_agent_activity_log
         WHERE feature_code = $1
         GROUP BY agent_name, agent_version
         ORDER BY max("timestamp") DESC
         LIMIT $2 OFFSET $3`,
        [FEATURE_CODE, historyPageSize, historyOffset],
      ) as Promise<
        Array<{ agent_name: string; agent_version: string; first_seen: Date; last_seen: Date; invocation_count: number }>
      >,
    ]);

    return {
      asOf: new Date().toISOString(),
      current: currentRows.map((r) => ({
        agentName: r.agent_name,
        agentVersion: r.agent_version,
        modelProvider: r.model_provider,
        lastInvokedAt: r.timestamp.toISOString(),
      })),
      history: {
        items: historyRows.map((r) => ({
          agentName: r.agent_name,
          agentVersion: r.agent_version,
          firstSeenAt: r.first_seen.toISOString(),
          lastSeenAt: r.last_seen.toISOString(),
          invocationCount: r.invocation_count,
        })),
        total: historyCountRows[0]?.total ?? 0,
        page: historyPage,
        pageSize: historyPageSize,
      },
    };
  }

  async getDataLineage(): Promise<DataLineageResponse> {
    const [mockBankRows, temporalRows, foundationApiRows] = await Promise.all([
      this.dataSource.query(
        `SELECT max("timestamp") AS last_refresh FROM platform_agent_activity_log
         WHERE feature_code = $1 AND data_sources_queried && $2::text[]`,
        [FEATURE_CODE, MOCK_BANK_SOURCES],
      ) as Promise<Array<{ last_refresh: Date | null }>>,
      // Every logged node execution ran as a Temporal activity (see
      // agent-service/app/features/aml_detection/activities.py) — any
      // row here is proof Temporal successfully orchestrated it.
      this.dataSource.query(
        `SELECT max("timestamp") AS last_refresh FROM platform_agent_activity_log WHERE feature_code = $1`,
        [FEATURE_CODE],
      ) as Promise<Array<{ last_refresh: Date | null }>>,
      this.dataSource.query(
        `SELECT max("timestamp") AS last_refresh FROM platform_agent_activity_log
         WHERE feature_code = $1 AND model_provider = 'foundation_api'`,
        [FEATURE_CODE],
      ) as Promise<Array<{ last_refresh: Date | null }>>,
    ]);

    const entries: DataLineageEntry[] = [
      {
        system: 'mock_bank_api',
        label: 'Mock bank API',
        usedFor: 'KYC snapshot, transaction timeline, linked entities — Phase 1/2 stand-in for core banking; see mvp-phases.md',
        cadence: 'on-demand, once per case (Evidence Gathering)',
        row: mockBankRows[0],
      },
      {
        system: 'temporal',
        label: 'Temporal workflow orchestration',
        usedFor: 'Durable execution of every agent node — a row here means the node ran, retried, and audited correctly',
        cadence: 'continuous, per case',
        row: temporalRows[0],
      },
      {
        system: 'foundation_api_openai',
        label: 'Foundation model API (OpenAI, via FOUNDATION_API)',
        usedFor: 'LLM calls made by nodes that generate/reason (Pattern Matching, Case & Narrative)',
        cadence: 'on-demand, per LLM call',
        row: foundationApiRows[0],
      },
    ].map(({ system, label, usedFor, cadence, row }) => {
      const lastRefreshAt = row?.last_refresh ?? null;
      return {
        system,
        label,
        usedFor,
        cadence,
        status: lineageStatus(lastRefreshAt),
        lastRefreshAt: lastRefreshAt ? lastRefreshAt.toISOString() : null,
      };
    });

    return { asOf: new Date().toISOString(), entries };
  }
}

function toSamplingReviewRow(r: AmlSamplingReview): SamplingReviewRow {
  return {
    reviewId: r.reviewId,
    caseId: r.caseId,
    originalDisposition: r.originalDisposition,
    reviewerId: r.reviewerId,
    reviewerAgreed: r.reviewerAgreed,
    reviewerNotes: r.reviewerNotes ?? null,
    reviewedAt: r.reviewedAt.toISOString(),
  };
}

function lineageStatus(lastRefreshAt: Date | null): LineageStatus {
  if (!lastRefreshAt) return 'not_yet_observed';
  const hoursSince = (Date.now() - lastRefreshAt.getTime()) / (1000 * 60 * 60);
  return hoursSince > STALE_AFTER_HOURS ? 'stale' : 'observed';
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
