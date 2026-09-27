import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AmlCase, CaseStatus } from '../entities/aml-case.entity.js';
import type { PlatformUser } from '../../../platform/entities/index.js';
import { RISK_TIER_RANGES, type RiskTierFilter, riskTierForScore, SLA_HOURS_BY_TIER } from '../sla.js';
import { agentStateSql, type AgentState } from '../agent-state.js';
import type { AgentStateOption, RecommendationOption, RiskTierOption, SlaOption, SortOption } from '../dto/list-alerts-query.dto.js';

export type { RiskTierFilter };

export interface AlertQueueFilters {
  q?: string;
  status?: CaseStatus[];
  riskTier?: RiskTierOption[];
  typology?: string[];
  recommendation?: RecommendationOption[];
  // Already resolved: `unassigned`, or a user ID (`me` → the caller).
  assignee?: string;
  receivedFrom?: string;
  receivedTo?: string;
  receivedAfter?: string;
  sla?: SlaOption;
  agentState?: AgentStateOption[];
  sort: SortOption;
  dir: 'asc' | 'desc';
  page: number;
  pageSize: number;
}

export interface AlertQueueFacets {
  typologies: Array<{ code: string; label: string }>;
  assignees: Array<{ userId: string; name: string }>;
}

// Risk tier and SLA deadline as SQL, generated from sla.ts so the
// filter/sort and the row's displayed SLA can't disagree.
const TIER_SQL = `CASE ${(Object.entries(RISK_TIER_RANGES) as Array<[RiskTierFilter, { min: number; max: number | null }]>)
  .map(([tier, r]) => `WHEN a.risk_score >= ${r.min}${r.max !== null ? ` AND a.risk_score <= ${r.max}` : ''} THEN '${tier}'`)
  .join(' ')} END`;
// An SLA only runs while the case is open work — a cleared or filed
// case has no deadline (null), so it never reads as "past due".
const CLOSED_STATUSES: CaseStatus[] = [CaseStatus.CLEARED, CaseStatus.FILED];
const SLA_DEADLINE_SQL = `(CASE WHEN c.status IN (${CLOSED_STATUSES.map((st) => `'${st}'`).join(', ')}) THEN NULL
  ELSE c.created_at + make_interval(hours => CASE ${(Object.entries(SLA_HOURS_BY_TIER) as Array<[RiskTierFilter, number]>)
    .map(([tier, hours]) => `WHEN ${TIER_SQL} = '${tier}' THEN ${hours}`)
    .join(' ')} END) END)`;
const AGENT_STATE_SQL = agentStateSql();

const FROM_SQL = `FROM aml_cases c
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       LEFT JOIN aml_typology_matches t ON t.case_id = c.case_id
       LEFT JOIN platform_users u ON u.user_id = c.assigned_analyst_id
       LEFT JOIN aml_evidence_bundles e ON e.case_id = c.case_id`;

const SORT_SQL: Record<SortOption, string> = {
  received: 'c.created_at',
  risk: 'a.risk_score',
  sla: SLA_DEADLINE_SQL,
  customer: `lower(coalesce(e.kyc ->> 'customer_name', c.alert ->> 'customer_id'))`,
  status: 'c.status',
};

// Guardrail G2: open cases with incomplete evidence "must be
// prioritized in Alert Queue" — pinned above whatever sort is chosen.
const G2_PIN_SQL = `(coalesce(e.evidence_incomplete, false) AND c.status NOT IN ('cleared', 'filed'))`;

export interface AlertQueueRow {
  caseId: string;
  agentState: AgentState;
  sourceAlertId: string;
  customerId: string;
  customerName: string | null;
  accountIds: string[];
  ruleFired: string;
  status: CaseStatus;
  riskScore: number | null;
  recommendation: string | null;
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
  // ADDITIVE (specs/platform/11-evals-and-guardrails-framework.md,
  // guardrail G2): true when the Evidence Gathering Agent couldn't
  // reach every data source — never silently scored as if the
  // evidence were complete, so it's surfaced and prioritized here.
  evidenceIncomplete: boolean;
  // Shown above the sorted rows (guardrail G2) — open + evidence incomplete.
  pinned: boolean;
}

interface AlertQueueRawRow {
  case_id: string;
  alert: { source_alert_id: string; customer_id: string; account_ids: string[]; rule_fired: string };
  status: CaseStatus;
  assigned_analyst_id: string | null;
  assigned_analyst_name: string | null;
  created_at: Date;
  risk_score: number | null;
  recommendation: string | null;
  recommendation_confidence: number | null;
  draft_narrative: string | null;
  typology_code: string | null;
  typology_label: string | null;
  customer_name: string | null;
  evidence_incomplete: boolean | null;
  agent_state: AgentState;
  pinned?: boolean;
}

@Injectable()
export class AlertQueueService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(filters: AlertQueueFilters): Promise<{ items: AlertQueueRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    const p = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (filters.q?.trim()) {
      const term = p(`%${filters.q.trim()}%`);
      const prefix = p(`${filters.q.trim().toLowerCase()}%`);
      conditions.push(`(c.alert ->> 'source_alert_id' ILIKE ${term} OR c.alert ->> 'customer_id' ILIKE ${term}
        OR e.kyc ->> 'customer_name' ILIKE ${term} OR c.case_id::text LIKE ${prefix})`);
    }
    if (filters.status?.length) conditions.push(`c.status = ANY(${p(filters.status)})`);
    if (filters.riskTier?.length) {
      const tiers = filters.riskTier.filter((t) => t !== 'unscored');
      const parts = tiers.length ? [`${TIER_SQL} = ANY(${p(tiers)})`] : [];
      if (filters.riskTier.includes('unscored')) parts.push('a.risk_score IS NULL');
      conditions.push(`(${parts.join(' OR ')})`);
    }
    if (filters.typology?.length) {
      const codes = filters.typology.filter((t) => t !== 'none');
      const parts = codes.length ? [`t.typology_code = ANY(${p(codes)})`] : [];
      if (filters.typology.includes('none')) parts.push('t.case_id IS NULL');
      conditions.push(`(${parts.join(' OR ')})`);
    }
    if (filters.recommendation?.length) {
      const recs = filters.recommendation.filter((r) => r !== 'none');
      const parts = recs.length ? [`a.recommendation = ANY(${p(recs)})`] : [];
      if (filters.recommendation.includes('none')) parts.push('a.recommendation IS NULL');
      conditions.push(`(${parts.join(' OR ')})`);
    }
    if (filters.assignee === 'unassigned') conditions.push('c.assigned_analyst_id IS NULL');
    else if (filters.assignee) conditions.push(`c.assigned_analyst_id = ${p(filters.assignee)}`);
    if (filters.receivedFrom) conditions.push(`c.created_at >= ${p(filters.receivedFrom)}`);
    if (filters.receivedTo) conditions.push(`c.created_at < ${p(filters.receivedTo)}`);
    if (filters.receivedAfter) conditions.push(`c.created_at > ${p(filters.receivedAfter)}`);
    if (filters.sla === 'past') conditions.push(`${SLA_DEADLINE_SQL} < now()`);
    if (filters.sla === 'due_24h') conditions.push(`${SLA_DEADLINE_SQL} BETWEEN now() AND now() + interval '24 hours'`);
    if (filters.agentState?.length) {
      const states = filters.agentState.flatMap((s) => (s === 'needs_attention' ? ['stalled', 'kill_switch'] : [s]));
      conditions.push(`${AGENT_STATE_SQL} = ANY(${p(states)})`);
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = (await this.dataSource.query(`SELECT count(*)::int AS total ${FROM_SQL} ${whereClause}`, params)) as Array<{
      total: number;
    }>;
    const total = countResult[0]?.total ?? 0;

    // Nulls (unscored) always last; ties by newest, then case ID, so
    // paging is stable under any sort.
    const direction = filters.dir === 'asc' ? 'ASC' : 'DESC';
    const orderBy = `${G2_PIN_SQL} DESC, ${SORT_SQL[filters.sort]} ${direction} NULLS LAST, c.created_at DESC, c.case_id`;
    const limit = p(filters.pageSize);
    const offset = p((filters.page - 1) * filters.pageSize);

    const rows = (await this.dataSource.query(
      `SELECT
         c.case_id, c.alert, c.status, c.assigned_analyst_id, c.created_at,
         u.display_name AS assigned_analyst_name,
         a.risk_score, a.recommendation, a.recommendation_confidence, a.draft_narrative,
         t.typology_code, t.typology_label,
         e.kyc ->> 'customer_name' AS customer_name,
         e.evidence_incomplete,
         ${AGENT_STATE_SQL} AS agent_state,
         ${G2_PIN_SQL} AS pinned
       ${FROM_SQL}
       ${whereClause}
       ORDER BY ${orderBy}
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    )) as AlertQueueRawRow[];

    return { items: rows.map((r) => this.toRow(r)), total };
  }

  /** Filter options that actually occur in cases — analysts can't read
   * the Typology Console, so its catalog isn't theirs to list. */
  async facets(): Promise<AlertQueueFacets> {
    const [typologies, assignees] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT ON (typology_code) typology_code AS code, typology_label AS label
         FROM aml_typology_matches ORDER BY typology_code, matched_at DESC`,
      ) as Promise<Array<{ code: string; label: string }>>,
      this.dataSource.query(
        `SELECT DISTINCT u.user_id AS "userId", u.display_name AS name
         FROM aml_cases c JOIN platform_users u ON u.user_id = c.assigned_analyst_id
         ORDER BY name`,
      ) as Promise<Array<{ userId: string; name: string }>>,
    ]);
    return { typologies, assignees };
  }

  /** Global search (shell/TopHeader) — matches on the alert's own
   * fields (source_alert_id, customer_id) and the assembled evidence
   * bundle's customer_name, whichever exist for a given case at query
   * time. Capped at 8 results; this is a jump-to-case finder, not a
   * general reporting surface. */
  async search(q: string): Promise<AlertQueueRow[]> {
    const term = q.trim();
    if (!term) return [];

    const rows = (await this.dataSource.query(
      `SELECT
         c.case_id, c.alert, c.status, c.assigned_analyst_id, c.created_at,
         u.display_name AS assigned_analyst_name,
         a.risk_score, a.recommendation, a.recommendation_confidence, a.draft_narrative,
         t.typology_code, t.typology_label,
         e.kyc ->> 'customer_name' AS customer_name,
         e.evidence_incomplete,
         ${agentStateSql()} AS agent_state
       FROM aml_cases c
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       LEFT JOIN aml_typology_matches t ON t.case_id = c.case_id
       LEFT JOIN platform_users u ON u.user_id = c.assigned_analyst_id
       LEFT JOIN aml_evidence_bundles e ON e.case_id = c.case_id
       WHERE c.alert ->> 'source_alert_id' ILIKE $1
          OR c.alert ->> 'customer_id' ILIKE $1
          OR e.kyc ->> 'customer_name' ILIKE $1
       ORDER BY c.created_at DESC
       LIMIT 8`,
      [`%${term}%`],
    )) as AlertQueueRawRow[];

    return rows.map((r) => this.toRow(r));
  }

  async claim(caseId: string, user: PlatformUser): Promise<{ caseId: string; assignedAnalystId: string }> {
    const existingCase = await this.dataSource.getRepository(AmlCase).findOneBy({ caseId });
    if (!existingCase) {
      throw new NotFoundException(`No AML case with case_id=${caseId}`);
    }

    await this.dataSource.getRepository(AmlCase).update(
      { caseId },
      {
        assignedAnalystId: user.userId,
        status: existingCase.status === CaseStatus.OPEN ? CaseStatus.CLAIMED : existingCase.status,
      },
    );

    return { caseId, assignedAnalystId: user.userId };
  }

  private toRow(r: AlertQueueRawRow): AlertQueueRow {
    const tier = riskTierForScore(r.risk_score);
    // Same rule as SLA_DEADLINE_SQL: no SLA once a case is closed.
    const slaTargetHours = tier && !CLOSED_STATUSES.includes(r.status) ? SLA_HOURS_BY_TIER[tier] : null;
    const hoursElapsed = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
    const slaRemainingHours = slaTargetHours !== null ? Math.round((slaTargetHours - hoursElapsed) * 10) / 10 : null;

    return {
      caseId: r.case_id,
      sourceAlertId: r.alert.source_alert_id,
      customerId: r.alert.customer_id,
      customerName: r.customer_name,
      accountIds: r.alert.account_ids,
      ruleFired: r.alert.rule_fired,
      status: r.status,
      riskScore: r.risk_score,
      recommendation: r.recommendation,
      recommendationConfidence: r.recommendation_confidence,
      narrativeSummary: r.draft_narrative ? firstSentence(r.draft_narrative) : null,
      typologyCode: r.typology_code,
      typologyLabel: r.typology_label,
      assignedAnalystId: r.assigned_analyst_id,
      assignedAnalystName: r.assigned_analyst_name,
      createdAt: new Date(r.created_at).toISOString(),
      slaTargetHours,
      slaRemainingHours,
      pastSla: slaRemainingHours !== null && slaRemainingHours < 0,
      agentState: r.agent_state,
      evidenceIncomplete: r.evidence_incomplete ?? false,
      pinned: r.pinned ?? false,
    };
  }
}

function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text);
  return match ? match[0].trim() : text;
}
