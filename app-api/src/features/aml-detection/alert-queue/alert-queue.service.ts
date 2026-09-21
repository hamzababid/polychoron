import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AmlCase, CaseStatus } from '../entities/aml-case.entity.js';
import type { PlatformUser } from '../../../platform/entities/index.js';
import { RISK_TIER_RANGES, type RiskTierFilter, riskTierForScore, SLA_HOURS_BY_TIER } from '../sla.js';

export type { RiskTierFilter };

export interface AlertQueueFilters {
  status?: CaseStatus;
  riskTier?: RiskTierFilter;
  page: number;
  pageSize: number;
}

export interface AlertQueueRow {
  caseId: string;
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
}

@Injectable()
export class AlertQueueService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(filters: AlertQueueFilters): Promise<{ items: AlertQueueRow[]; total: number }> {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters.status) {
      params.push(filters.status);
      conditions.push(`c.status = $${params.length}`);
    }
    if (filters.riskTier) {
      const range = RISK_TIER_RANGES[filters.riskTier];
      params.push(range.min);
      conditions.push(`a.risk_score >= $${params.length}`);
      if (range.max !== null) {
        params.push(range.max);
        conditions.push(`a.risk_score <= $${params.length}`);
      }
    }
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = (await this.dataSource.query(
      `SELECT count(*)::int AS total
       FROM aml_cases c
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       ${whereClause}`,
      params,
    )) as Array<{ total: number }>;
    const total = countResult[0]?.total ?? 0;

    const limit = filters.pageSize;
    const offset = (filters.page - 1) * filters.pageSize;
    const rowParams = [...params, limit, offset];

    const rows = (await this.dataSource.query(
      `SELECT
         c.case_id, c.alert, c.status, c.assigned_analyst_id, c.created_at,
         u.display_name AS assigned_analyst_name,
         a.risk_score, a.recommendation, a.recommendation_confidence, a.draft_narrative,
         t.typology_code, t.typology_label,
         e.kyc ->> 'customer_name' AS customer_name
       FROM aml_cases c
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       LEFT JOIN aml_typology_matches t ON t.case_id = c.case_id
       LEFT JOIN platform_users u ON u.user_id = c.assigned_analyst_id
       LEFT JOIN aml_evidence_bundles e ON e.case_id = c.case_id
       ${whereClause}
       ORDER BY a.risk_score DESC NULLS LAST, c.created_at DESC
       LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams,
    )) as AlertQueueRawRow[];

    return { items: rows.map((r) => this.toRow(r)), total };
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
         e.kyc ->> 'customer_name' AS customer_name
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
    const slaTargetHours = tier ? SLA_HOURS_BY_TIER[tier] : null;
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
    };
  }
}

function firstSentence(text: string): string {
  const match = /^[^.!?]*[.!?]/.exec(text);
  return match ? match[0].trim() : text;
}
