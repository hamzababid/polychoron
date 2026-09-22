import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { riskTierForScore, SLA_HOURS_BY_TIER, type RiskTierFilter } from '../sla.js';

export interface DashboardSummary {
  openAlertsByTier: Record<RiskTierFilter, number>;
  strCtrVolumeThisPeriod: { str: number; ctr: number };
  agingAlertsCount: number;
  agentVsHumanOverrideRate: number;
  branchRiskHeatmap: Array<{ branchCode: string; riskTier: RiskTierFilter; openCaseCount: number }>;
}

export interface MonthlyTrendPoint {
  month: string; // 'YYYY-MM'
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

const OPEN_STATUSES = ['open', 'claimed', 'investigating', 'escalated', 'pending_filing'];
const TREND_MONTHS = 6;
const MOST_AGING_LIMIT = 3;
// Matches screens/01-dashboard.md's actual false-positive definition
// (agent flagged suspicion, officer cleared it) -- not "any cleared
// case", which is looser than what the screen spec actually asks for.
const SUSPICION_RECOMMENDATIONS = ['escalate', 'recommend_str'];

/**
 * specs/suites/bfsi/features/aml-detection/phase-1-aml-core/api-contracts-phase1.md:
 * "Dashboard (minimal — Phase 2 has the full version): GET .../reports/summary-basic
 * -> just the four top-line counts needed for a non-empty Phase 1
 * dashboard tile row." screens/01-dashboard.md describes a much larger
 * surface (trend chart, false-positive trend over time, full IRAR
 * heat-map) that reuses the Reporting & MI endpoint — that endpoint is
 * explicitly Phase 2 scope (mvp-phases.md), so this implementation
 * covers the four top-line figures the current contract actually
 * promises, plus the branch heat-map (since BranchRiskSnapshot was
 * added for Phase 1) — not the full trend/time-series version.
 */
@Injectable()
export class DashboardService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getSummary(): Promise<DashboardSummary> {
    const [openAlertsByTier, strCtrVolumeThisPeriod, agingAlertsCount, agentVsHumanOverrideRate, branchRiskHeatmap] =
      await Promise.all([
        this.getOpenAlertsByTier(),
        this.getStrCtrVolumeThisPeriod(),
        this.getAgingAlertsCount(),
        this.getAgentVsHumanOverrideRate(),
        this.getBranchRiskHeatmap(),
      ]);

    return { openAlertsByTier, strCtrVolumeThisPeriod, agingAlertsCount, agentVsHumanOverrideRate, branchRiskHeatmap };
  }

  private async getOpenAlertsByTier(): Promise<Record<RiskTierFilter, number>> {
    const rows = (await this.dataSource.query(
      `SELECT a.risk_score FROM aml_cases c
       JOIN aml_case_assessments a ON a.case_id = c.case_id
       WHERE c.status = ANY($1)`,
      [OPEN_STATUSES],
    )) as Array<{ risk_score: number }>;

    const counts: Record<RiskTierFilter, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const row of rows) {
      const tier = riskTierForScore(row.risk_score);
      if (tier) counts[tier] += 1;
    }
    return counts;
  }

  private async getStrCtrVolumeThisPeriod(): Promise<{ str: number; ctr: number }> {
    const rows = (await this.dataSource.query(
      `SELECT report_type, count(*)::int AS cnt FROM aml_str_filings
       WHERE submitted_at >= date_trunc('month', now())
       GROUP BY report_type`,
    )) as Array<{ report_type: string; cnt: number }>;

    return {
      str: rows.find((r) => r.report_type === 'str_f')?.cnt ?? 0,
      ctr: rows.find((r) => r.report_type === 'ctr')?.cnt ?? 0,
    };
  }

  private async getAgingAlertsCount(): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT c.created_at, a.risk_score FROM aml_cases c
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       WHERE c.status = ANY($1)`,
      [OPEN_STATUSES],
    )) as Array<{ created_at: Date; risk_score: number | null }>;

    let agingCount = 0;
    for (const row of rows) {
      const tier = riskTierForScore(row.risk_score);
      if (!tier) continue;
      const hoursElapsed = (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60);
      if (hoursElapsed > SLA_HOURS_BY_TIER[tier]) agingCount += 1;
    }
    return agingCount;
  }

  private async getAgentVsHumanOverrideRate(): Promise<number> {
    const rows = (await this.dataSource.query(
      `SELECT overrides_agent_recommendation FROM aml_dispositions`,
    )) as Array<{ overrides_agent_recommendation: boolean }>;
    if (rows.length === 0) return 0;
    const overrides = rows.filter((r) => r.overrides_agent_recommendation).length;
    return Math.round((overrides / rows.length) * 1000) / 1000;
  }

  private async getBranchRiskHeatmap(): Promise<Array<{ branchCode: string; riskTier: RiskTierFilter; openCaseCount: number }>> {
    const rows = (await this.dataSource.query(
      `SELECT (e.transaction_timeline -> 0 ->> 'branch_code') AS branch_code, a.risk_score
       FROM aml_cases c
       JOIN aml_evidence_bundles e ON e.case_id = c.case_id
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       WHERE c.status = ANY($1) AND (e.transaction_timeline -> 0 ->> 'branch_code') IS NOT NULL`,
      [OPEN_STATUSES],
    )) as Array<{ branch_code: string; risk_score: number | null }>;

    const counts = new Map<string, number>();
    for (const row of rows) {
      const tier = riskTierForScore(row.risk_score);
      if (!tier) continue;
      const key = `${row.branch_code} ${tier}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    // "Snapshotted" on read (see aml_branch_risk_snapshots' migration
    // comment) rather than on a schedule — Phase 2 owns real periodic
    // snapshotting.
    for (const [key, count] of counts) {
      const [branchCode, tier] = key.split(' ');
      await this.dataSource.query(
        `INSERT INTO aml_branch_risk_snapshots (branch_code, risk_tier, open_case_count, snapshot_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (branch_code, risk_tier) DO UPDATE SET
           open_case_count = EXCLUDED.open_case_count,
           snapshot_at = EXCLUDED.snapshot_at`,
        [branchCode, tier, count],
      );
    }

    const snapshotRows = (await this.dataSource.query(
      `SELECT branch_code, risk_tier, open_case_count FROM aml_branch_risk_snapshots ORDER BY branch_code, risk_tier`,
    )) as Array<{ branch_code: string; risk_tier: RiskTierFilter; open_case_count: number }>;

    return snapshotRows.map((r) => ({ branchCode: r.branch_code, riskTier: r.risk_tier, openCaseCount: r.open_case_count }));
  }

  /** TASKS.md's "ADDITIVE — Dashboard Trend Widgets" — new methods on
   * this same service (not a new one), so Phase 2's `reports/summary`
   * can call these at full granularity later and never diverge from
   * what the Dashboard shows (api-contracts-phase2.md's "single
   * source of truth" note). */
  async getTrends(): Promise<DashboardTrends> {
    const [monthlyTrend, dispositionBreakdown, mostAgingAlerts] = await Promise.all([
      this.getMonthlyTrend(),
      this.getDispositionBreakdown(),
      this.getMostAgingAlerts(),
    ]);
    return { monthlyTrend, dispositionBreakdown, mostAgingAlerts };
  }

  private async getMonthlyTrend(): Promise<MonthlyTrendPoint[]> {
    const rows = (await this.dataSource.query(
      `SELECT
         to_char(date_trunc('month', c.created_at), 'YYYY-MM') AS month,
         count(DISTINCT c.case_id)::int AS alerts_raised,
         count(DISTINCT c.case_id) FILTER (
           WHERE f.report_type = 'str_f' AND f.submission_status <> 'draft'
         )::int AS str_filed,
         count(DISTINCT c.case_id) FILTER (
           WHERE d.disposition_type = 'clear' AND a.recommendation = ANY($1)
         )::int AS false_positive_count
       FROM aml_cases c
       LEFT JOIN aml_str_filings f ON f.case_id = c.case_id
       LEFT JOIN aml_dispositions d ON d.case_id = c.case_id
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       WHERE c.created_at >= date_trunc('month', now()) - interval '${TREND_MONTHS - 1} months'
       GROUP BY 1
       ORDER BY 1`,
      [SUSPICION_RECOMMENDATIONS],
    )) as Array<{ month: string; alerts_raised: number; str_filed: number; false_positive_count: number }>;

    const byMonth = new Map(rows.map((r) => [r.month, r]));
    const points: MonthlyTrendPoint[] = [];
    const cursor = new Date();
    cursor.setUTCDate(1);
    cursor.setUTCMonth(cursor.getUTCMonth() - (TREND_MONTHS - 1));
    for (let i = 0; i < TREND_MONTHS; i++) {
      const month = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
      const row = byMonth.get(month);
      const alertsRaised = row?.alerts_raised ?? 0;
      points.push({
        month,
        alertsRaised,
        strFiled: row?.str_filed ?? 0,
        strConversionRate: alertsRaised > 0 ? round3((row?.str_filed ?? 0) / alertsRaised) : 0,
        falsePositiveRate: alertsRaised > 0 ? round3((row?.false_positive_count ?? 0) / alertsRaised) : 0,
      });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return points;
  }

  /** Public (not just used by getTrends()) so ReportingService can call
   * this exact same computation for an explicit period — Reporting &
   * MI's acceptance criteria require its agent-workload figures to
   * match Dashboard's exactly for the same period, so it must be the
   * literal same method, not a re-implementation. Defaults to the
   * existing trailing-6-months window when no period is given, so
   * Dashboard's own call site is unaffected. */
  async getDispositionBreakdown(periodStart?: Date, periodEnd?: Date): Promise<DispositionBreakdown> {
    const start = periodStart ?? null;
    const end = periodEnd ?? null;
    const rows = (await this.dataSource.query(
      `SELECT d.overrides_agent_recommendation, count(*)::int AS cnt
       FROM aml_dispositions d
       JOIN aml_cases c ON c.case_id = d.case_id
       WHERE c.created_at >= COALESCE($1::timestamptz, date_trunc('month', now()) - interval '${TREND_MONTHS - 1} months')
         AND c.created_at < COALESCE($2::timestamptz, now() + interval '1 day')
       GROUP BY d.overrides_agent_recommendation`,
      [start, end],
    )) as Array<{ overrides_agent_recommendation: boolean; cnt: number }>;

    const overrodeAgent = rows.find((r) => r.overrides_agent_recommendation)?.cnt ?? 0;
    const agreedWithAgent = rows.find((r) => !r.overrides_agent_recommendation)?.cnt ?? 0;
    return { totalDispositioned: overrodeAgent + agreedWithAgent, agreedWithAgent, overrodeAgent };
  }

  private async getMostAgingAlerts(): Promise<AgingAlertSummary[]> {
    const rows = (await this.dataSource.query(
      `SELECT
         c.case_id, c.alert, c.created_at, a.risk_score,
         t.typology_label, u.display_name AS assigned_analyst_name,
         e.kyc ->> 'customer_name' AS customer_name
       FROM aml_cases c
       LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
       LEFT JOIN aml_typology_matches t ON t.case_id = c.case_id
       LEFT JOIN platform_users u ON u.user_id = c.assigned_analyst_id
       LEFT JOIN aml_evidence_bundles e ON e.case_id = c.case_id
       WHERE c.status = ANY($1)`,
      [OPEN_STATUSES],
    )) as Array<{
      case_id: string;
      alert: { source_alert_id: string };
      created_at: Date;
      risk_score: number | null;
      typology_label: string | null;
      assigned_analyst_name: string | null;
      customer_name: string | null;
    }>;

    const withSla = rows
      .map((r) => {
        const tier = riskTierForScore(r.risk_score);
        const slaTargetHours = tier ? SLA_HOURS_BY_TIER[tier] : null;
        const hoursElapsed = (Date.now() - new Date(r.created_at).getTime()) / (1000 * 60 * 60);
        const slaRemainingHours = slaTargetHours !== null ? Math.round((slaTargetHours - hoursElapsed) * 10) / 10 : null;
        return { row: r, slaRemainingHours };
      })
      .filter((x) => x.slaRemainingHours !== null)
      .sort((a, b) => a.slaRemainingHours! - b.slaRemainingHours!)
      .slice(0, MOST_AGING_LIMIT);

    return withSla.map(({ row, slaRemainingHours }) => ({
      caseId: row.case_id,
      sourceAlertId: row.alert.source_alert_id,
      customerName: row.customer_name,
      riskScore: row.risk_score,
      slaRemainingHours,
      typologyLabel: row.typology_label,
      assignedAnalystName: row.assigned_analyst_name,
    }));
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
