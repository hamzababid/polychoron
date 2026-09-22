import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AmlReportGeneration } from '../entities/aml-report-generation.entity.js';
import { DashboardService, type DispositionBreakdown } from '../dashboard/dashboard.service.js';
import { riskTierForScore, SLA_HOURS_BY_TIER, type RiskTierFilter } from '../sla.js';

export type BreakdownBy = 'type' | 'typology' | 'branch';

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
  tier: RiskTierFilter;
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
  breakdownBy: BreakdownBy;
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

export interface ReportFile {
  fileName: string;
  content: Buffer;
}

const TIERS: RiskTierFilter[] = ['critical', 'high', 'medium', 'low'];

/** specs/suites/bfsi/features/aml-detection/screens/10-reporting-mi.md
 * "Every figure on this screen matches the Dashboard's figures for the
 * same period exactly" — agentWorkload calls DashboardService's own
 * method directly (see dashboard.service.ts's getDispositionBreakdown
 * doc comment) rather than re-implementing the query here. Everything
 * else below is new (Dashboard's screen doesn't need it): avg
 * time-to-file, SLA adherence by tier, and filing-volume breakdowns —
 * these live here, not bolted onto DashboardService, since nothing
 * else calls them. */
@Injectable()
export class ReportingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlReportGeneration) private readonly reports: Repository<AmlReportGeneration>,
    private readonly dashboardService: DashboardService,
  ) {}

  async getSummary(params: {
    periodStart: Date;
    periodEnd: Date;
    comparePrevious: boolean;
    breakdownBy: BreakdownBy;
  }): Promise<ReportingSummary> {
    const { periodStart, periodEnd, comparePrevious, breakdownBy } = params;
    const periodLengthMs = periodEnd.getTime() - periodStart.getTime();
    const prevStart = comparePrevious ? new Date(periodStart.getTime() - periodLengthMs) : null;
    const prevEnd = comparePrevious ? periodStart : null;

    const [current, previous, monthlyFilingVolume, breakdown, agentWorkload] = await Promise.all([
      this.computePeriodFigures(periodStart, periodEnd),
      comparePrevious ? this.computePeriodFigures(prevStart!, prevEnd!) : Promise.resolve(null),
      this.getMonthlyFilingVolume(periodStart, periodEnd),
      this.getBreakdown(periodStart, periodEnd, breakdownBy),
      this.dashboardService.getDispositionBreakdown(periodStart, periodEnd),
    ]);

    const slaByTier: SlaTierRow[] = TIERS.map((tier) => {
      const cur = current.slaByTier[tier];
      const prev = previous?.slaByTier[tier];
      return {
        tier,
        targetHours: SLA_HOURS_BY_TIER[tier],
        total: cur.total,
        breached: cur.breached,
        adherenceRate: cur.total > 0 ? round3((cur.total - cur.breached) / cur.total) : null,
        previousAdherenceRate: prev && prev.total > 0 ? round3((prev.total - prev.breached) / prev.total) : null,
      };
    });

    return {
      asOf: new Date().toISOString(),
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      comparePrevious,
      previousPeriodStart: prevStart ? prevStart.toISOString() : null,
      previousPeriodEnd: prevEnd ? prevEnd.toISOString() : null,
      strFiledCount: current.strCount,
      strFiledPrevCount: previous?.strCount ?? null,
      ctrFiledCount: current.ctrCount,
      ctrFiledPrevCount: previous?.ctrCount ?? null,
      avgTimeToFileHours: current.avgTimeToFileHours,
      avgTimeToFilePrevHours: previous?.avgTimeToFileHours ?? null,
      slaAdherenceOverall: current.slaOverallTotal > 0 ? round3((current.slaOverallTotal - current.slaOverallBreached) / current.slaOverallTotal) : null,
      slaAdherenceOverallPrev:
        previous && previous.slaOverallTotal > 0 ? round3((previous.slaOverallTotal - previous.slaOverallBreached) / previous.slaOverallTotal) : null,
      slaByTier,
      monthlyFilingVolume,
      breakdownBy,
      breakdown,
      agentWorkload,
    };
  }

  private async computePeriodFigures(start: Date, end: Date) {
    const [filingCountRows, avgTimeRows, slaRows] = await Promise.all([
      this.dataSource.query(
        `SELECT
           count(*) FILTER (WHERE report_type IN ('str_f', 'str_a'))::int AS str_count,
           count(*) FILTER (WHERE report_type IN ('ctr', 'ctr_a'))::int AS ctr_count
         FROM aml_str_filings
         WHERE submitted_at >= $1 AND submitted_at < $2 AND submission_status <> 'draft'`,
        [start, end],
      ) as Promise<Array<{ str_count: number; ctr_count: number }>>,
      this.dataSource.query(
        `SELECT avg(EXTRACT(EPOCH FROM (f.submitted_at - d.decided_at)) / 3600.0) AS avg_hours
         FROM aml_str_filings f
         JOIN aml_dispositions d ON d.case_id = f.case_id
         WHERE f.report_type IN ('str_f', 'str_a') AND f.submitted_at >= $1 AND f.submitted_at < $2 AND f.submission_status <> 'draft'`,
        [start, end],
      ) as Promise<Array<{ avg_hours: string | null }>>,
      this.dataSource.query(
        `SELECT a.risk_score, c.created_at, d.decided_at
         FROM aml_cases c
         JOIN aml_dispositions d ON d.case_id = c.case_id
         LEFT JOIN aml_case_assessments a ON a.case_id = c.case_id
         WHERE d.decided_at >= $1 AND d.decided_at < $2`,
        [start, end],
      ) as Promise<Array<{ risk_score: number | null; created_at: Date; decided_at: Date }>>,
    ]);

    const slaByTier: Record<RiskTierFilter, { total: number; breached: number }> = {
      critical: { total: 0, breached: 0 },
      high: { total: 0, breached: 0 },
      medium: { total: 0, breached: 0 },
      low: { total: 0, breached: 0 },
    };
    for (const row of slaRows) {
      const tier = riskTierForScore(row.risk_score);
      if (!tier) continue;
      const hoursElapsed = (row.decided_at.getTime() - row.created_at.getTime()) / (1000 * 60 * 60);
      slaByTier[tier].total += 1;
      if (hoursElapsed > SLA_HOURS_BY_TIER[tier]) slaByTier[tier].breached += 1;
    }
    const slaOverallTotal = TIERS.reduce((sum, t) => sum + slaByTier[t].total, 0);
    const slaOverallBreached = TIERS.reduce((sum, t) => sum + slaByTier[t].breached, 0);

    return {
      strCount: filingCountRows[0]?.str_count ?? 0,
      ctrCount: filingCountRows[0]?.ctr_count ?? 0,
      avgTimeToFileHours: avgTimeRows[0]?.avg_hours != null ? round3(Number(avgTimeRows[0].avg_hours)) : null,
      slaByTier,
      slaOverallTotal,
      slaOverallBreached,
    };
  }

  private async getMonthlyFilingVolume(start: Date, end: Date): Promise<FilingVolumeMonthPoint[]> {
    const rows = (await this.dataSource.query(
      `SELECT
         to_char(date_trunc('month', submitted_at), 'YYYY-MM') AS month,
         count(*) FILTER (WHERE report_type IN ('str_f', 'str_a'))::int AS str_count,
         count(*) FILTER (WHERE report_type IN ('ctr', 'ctr_a'))::int AS ctr_count
       FROM aml_str_filings
       WHERE submitted_at >= $1 AND submitted_at < $2 AND submission_status <> 'draft'
       GROUP BY 1 ORDER BY 1`,
      [start, end],
    )) as Array<{ month: string; str_count: number; ctr_count: number }>;
    return rows.map((r) => ({ month: r.month, strCount: r.str_count, ctrCount: r.ctr_count }));
  }

  private async getBreakdown(start: Date, end: Date, breakdownBy: BreakdownBy): Promise<FilingBreakdownRow[]> {
    let rows: Array<{ code: string; label: string; cnt: number }>;
    if (breakdownBy === 'type') {
      rows = (await this.dataSource.query(
        `SELECT report_type AS code, report_type AS label, count(*)::int AS cnt
         FROM aml_str_filings
         WHERE submitted_at >= $1 AND submitted_at < $2 AND submission_status <> 'draft'
         GROUP BY report_type ORDER BY cnt DESC`,
        [start, end],
      )) as Array<{ code: string; label: string; cnt: number }>;
    } else if (breakdownBy === 'typology') {
      rows = (await this.dataSource.query(
        `SELECT t.typology_code AS code, t.typology_label AS label, count(*)::int AS cnt
         FROM aml_str_filings f
         JOIN aml_typology_matches t ON t.case_id = f.case_id
         WHERE f.report_type IN ('str_f', 'str_a') AND f.submitted_at >= $1 AND f.submitted_at < $2 AND f.submission_status <> 'draft'
         GROUP BY t.typology_code, t.typology_label ORDER BY cnt DESC`,
        [start, end],
      )) as Array<{ code: string; label: string; cnt: number }>;
    } else {
      rows = (await this.dataSource.query(
        `SELECT (e.transaction_timeline -> 0 ->> 'branch_code') AS code, (e.transaction_timeline -> 0 ->> 'branch_code') AS label, count(*)::int AS cnt
         FROM aml_str_filings f
         JOIN aml_evidence_bundles e ON e.case_id = f.case_id
         WHERE f.report_type IN ('str_f', 'str_a') AND f.submitted_at >= $1 AND f.submitted_at < $2 AND f.submission_status <> 'draft'
           AND (e.transaction_timeline -> 0 ->> 'branch_code') IS NOT NULL
         GROUP BY 1 ORDER BY cnt DESC`,
        [start, end],
      )) as Array<{ code: string; label: string; cnt: number }>;
    }

    const total = rows.reduce((sum, r) => sum + r.cnt, 0);
    return rows.map((r) => ({
      code: r.code,
      label: r.label,
      count: r.cnt,
      percentOfTotal: total > 0 ? round3(r.cnt / total) : 0,
    }));
  }

  async generateReport(dto: {
    report_name: string;
    period_start: string;
    period_end: string;
    compare_previous?: boolean;
    breakdown_by?: BreakdownBy;
    format: 'csv';
    generated_by: string;
  }): Promise<ReportHistoryEntry> {
    const periodStart = new Date(dto.period_start);
    const periodEnd = new Date(dto.period_end);
    const summary = await this.getSummary({
      periodStart,
      periodEnd,
      comparePrevious: dto.compare_previous ?? false,
      breakdownBy: dto.breakdown_by ?? 'type',
    });

    const periodLabel = `${periodStart.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`;
    const csv = buildCsv(dto.report_name, periodLabel, summary);
    const fileContent = Buffer.from(csv, 'utf-8');
    const contentHash = createHash('sha256').update(fileContent).digest('hex');
    const fileName = `${dto.report_name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${periodStart.toISOString().slice(0, 10)}.csv`;

    const saved = await this.reports.save({
      reportName: dto.report_name,
      periodLabel,
      periodStart,
      periodEnd,
      comparePrevious: dto.compare_previous ?? false,
      breakdownBy: dto.breakdown_by ?? 'type',
      format: 'csv',
      fileName,
      contentHash,
      fileContent,
      generatedBy: dto.generated_by,
    });

    return toHistoryEntry(saved);
  }

  async getHistory(): Promise<ReportHistoryEntry[]> {
    const rows = await this.reports.find({ order: { generatedAt: 'DESC' } });
    return rows.map(toHistoryEntry);
  }

  async getReportFile(reportId: string): Promise<ReportFile> {
    const row = await this.reports
      .createQueryBuilder('r')
      .addSelect('r.fileContent')
      .where('r.reportId = :reportId', { reportId })
      .getOne();
    if (!row) {
      throw new NotFoundException(`No report with report_id=${reportId}`);
    }
    return { fileName: row.fileName, content: row.fileContent };
  }
}

function toHistoryEntry(r: AmlReportGeneration): ReportHistoryEntry {
  return {
    reportId: r.reportId,
    reportName: r.reportName,
    periodLabel: r.periodLabel,
    format: r.format,
    fileName: r.fileName,
    contentHash: r.contentHash,
    generatedBy: r.generatedBy,
    generatedAt: r.generatedAt.toISOString(),
  };
}

function csvEscape(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvRow(values: Array<string | number>): string {
  return values.map(csvEscape).join(',') + '\n';
}

function buildCsv(reportName: string, periodLabel: string, s: ReportingSummary): string {
  let out = '';
  out += csvRow(['Report', reportName]);
  out += csvRow(['Period', periodLabel]);
  out += csvRow(['Generated (as of)', s.asOf]);
  out += csvRow(['Compare to previous period', s.comparePrevious ? 'yes' : 'no']);
  out += '\n';

  out += csvRow(['Metric', 'Value', 'Previous period']);
  out += csvRow(['STR-F filed', s.strFiledCount, s.strFiledPrevCount ?? '']);
  out += csvRow(['CTR filed', s.ctrFiledCount, s.ctrFiledPrevCount ?? '']);
  out += csvRow(['Avg. time to file (hours)', s.avgTimeToFileHours ?? '', s.avgTimeToFilePrevHours ?? '']);
  out += csvRow(['SLA adherence (overall)', s.slaAdherenceOverall ?? '', s.slaAdherenceOverallPrev ?? '']);
  out += '\n';

  out += csvRow(['Month', 'STR-F', 'CTR']);
  for (const p of s.monthlyFilingVolume) out += csvRow([p.month, p.strCount, p.ctrCount]);
  out += '\n';

  out += csvRow([`Breakdown by ${s.breakdownBy}`, 'Count', '% of total']);
  for (const b of s.breakdown) out += csvRow([b.label, b.count, b.percentOfTotal]);
  out += '\n';

  out += csvRow(['Risk tier', 'Target (hours)', 'Total', 'Breached', 'Adherence', 'Previous adherence']);
  for (const t of s.slaByTier) out += csvRow([t.tier, t.targetHours, t.total, t.breached, t.adherenceRate ?? '', t.previousAdherenceRate ?? '']);
  out += '\n';

  out += csvRow(['Agent workload', 'Count']);
  out += csvRow(['Agreed with agent', s.agentWorkload.agreedWithAgent]);
  out += csvRow(['Overrode agent', s.agentWorkload.overrodeAgent]);
  out += csvRow(['Total dispositioned', s.agentWorkload.totalDispositioned]);

  return out;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
