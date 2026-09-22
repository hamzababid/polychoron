import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AmlTypologyConfig } from '../entities/aml-typology-config.entity.js';
import { AmlTypologyConfigVersion } from '../entities/aml-typology-config-version.entity.js';
import { AmlTypologyBacktestJob, BacktestJobStatus } from '../entities/aml-typology-backtest-job.entity.js';
import { AmlTypologyPromotion } from '../entities/aml-typology-promotion.entity.js';

export interface TypologyRow {
  typologyCode: string;
  typologyLabel: string;
  ruleLogicDescription: string;
  active: boolean;
  productionVersion: number;
  alertVolume30d: number;
  strConversionRate: number;
  falsePositiveRate: number;
  // A real, currently-running/queued backtest job — not "this typology
  // has ever been backtested". Drives the "DRAFT IN BACKTEST" badge
  // (design-exports/.../Typology Rules Console.dc.html).
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

@Injectable()
export class TypologyConsoleService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlTypologyConfig) private readonly configs: Repository<AmlTypologyConfig>,
    @InjectRepository(AmlTypologyConfigVersion) private readonly versions: Repository<AmlTypologyConfigVersion>,
    @InjectRepository(AmlTypologyBacktestJob) private readonly backtestJobs: Repository<AmlTypologyBacktestJob>,
    @InjectRepository(AmlTypologyPromotion) private readonly promotions: Repository<AmlTypologyPromotion>,
  ) {}

  async list(): Promise<TypologyConsoleOverview> {
    const [configRows, metricRows, activeBacktestRows, lastPromotionRows] = await Promise.all([
      this.configs.find({ order: { typologyCode: 'ASC' } }),
      this.dataSource.query(`
        SELECT
          t.typology_code,
          count(*) FILTER (WHERE c.created_at >= now() - interval '30 days')::int AS alert_volume_30d,
          count(d.case_id) FILTER (WHERE d.disposition_type IN ('file_str', 'file_ctr'))::int AS str_count,
          count(d.case_id) FILTER (
            WHERE d.disposition_type = 'clear' AND a.recommendation IN ('escalate', 'recommend_str', 'recommend_ctr')
          )::int AS false_positive_count,
          count(d.case_id)::int AS total_dispositioned
        FROM aml_typology_matches t
        JOIN aml_cases c ON c.case_id = t.case_id
        LEFT JOIN aml_dispositions d ON d.case_id = t.case_id
        LEFT JOIN aml_case_assessments a ON a.case_id = t.case_id
        GROUP BY t.typology_code
      `) as Promise<
        Array<{
          typology_code: string;
          alert_volume_30d: number;
          str_count: number;
          false_positive_count: number;
          total_dispositioned: number;
        }>
      >,
      this.dataSource.query(`
        SELECT DISTINCT ON (typology_code) typology_code, status
        FROM aml_typology_backtest_jobs
        ORDER BY typology_code, started_at DESC
      `) as Promise<Array<{ typology_code: string; status: string }>>,
      this.dataSource.query(`
        SELECT p.typology_code, c.typology_label, p.promoted_version, p.promoted_by, p.promoted_at
        FROM aml_typology_promotions p
        JOIN aml_typology_configs c ON c.typology_code = p.typology_code
        ORDER BY p.promoted_at DESC
        LIMIT 1
      `) as Promise<
        Array<{ typology_code: string; typology_label: string; promoted_version: number; promoted_by: string; promoted_at: Date }>
      >,
    ]);

    const metricsByCode = new Map(metricRows.map((m) => [m.typology_code, m]));
    const activeBacktestByCode = new Map(activeBacktestRows.map((r) => [r.typology_code, r.status]));

    const typologies = configRows.map((c) => {
      const m = metricsByCode.get(c.typologyCode);
      const total = m?.total_dispositioned ?? 0;
      const backtestStatus = activeBacktestByCode.get(c.typologyCode);
      return {
        typologyCode: c.typologyCode,
        typologyLabel: c.typologyLabel,
        ruleLogicDescription: c.ruleLogicDescription,
        active: c.active,
        productionVersion: c.productionVersion,
        alertVolume30d: m?.alert_volume_30d ?? 0,
        strConversionRate: total > 0 ? m!.str_count / total : 0,
        falsePositiveRate: total > 0 ? m!.false_positive_count / total : 0,
        hasActiveBacktest: backtestStatus === 'queued' || backtestStatus === 'running',
      };
    });

    const lp = lastPromotionRows[0];
    return {
      typologies,
      lastPromotion: lp
        ? {
            typologyCode: lp.typology_code,
            typologyLabel: lp.typology_label,
            promotedVersion: lp.promoted_version,
            promotedBy: lp.promoted_by,
            promotedAt: lp.promoted_at.toISOString(),
          }
        : null,
    };
  }

  async getHistory(typologyCode: string): Promise<AmlTypologyConfigVersion[]> {
    await this.requireConfig(typologyCode);
    return this.versions.find({ where: { typologyCode }, order: { version: 'DESC' } });
  }

  /**
   * Saves a rule-logic edit and/or active/inactive toggle as a new
   * version — every change writes a version-history row, including a
   * bare toggle (screen spec's explicit instruction).
   */
  async update(
    typologyCode: string,
    dto: { rule_logic_description?: string; active?: boolean; change_reason: string; changed_by: string },
  ): Promise<AmlTypologyConfig> {
    const config = await this.requireConfig(typologyCode);
    const latest = await this.versions.findOne({ where: { typologyCode }, order: { version: 'DESC' } });
    const nextVersion = (latest?.version ?? 0) + 1;

    const ruleLogicDescription = dto.rule_logic_description ?? config.ruleLogicDescription;
    const active = dto.active ?? config.active;

    await this.versions.save({
      typologyCode,
      version: nextVersion,
      ruleLogicDescription,
      active,
      changedBy: dto.changed_by,
      changedAt: new Date(),
      changeReason: dto.change_reason,
    });
    await this.configs.update({ typologyCode }, { ruleLogicDescription, active });

    return this.requireConfig(typologyCode);
  }

  /**
   * Phase 2 baseline backtest: computes the CURRENT production
   * agreement rate for this typology from real historical Case/
   * Disposition data (does the agent's recommendation, when this
   * typology matched, agree with what the officer ultimately decided).
   * This does not yet re-run a draft rule-logic edit through the agent
   * chain in shadow mode (agent-implementation.md's fuller shadow-mode
   * spec) — that requires re-invoking the Pattern Matching Agent
   * against historical evidence bundles with the draft config, a
   * larger, separately-scoped follow-up. Flagged here rather than
   * silently presented as a real shadow comparison.
   */
  async startBacktest(typologyCode: string): Promise<AmlTypologyBacktestJob> {
    await this.requireConfig(typologyCode);

    const job = await this.backtestJobs.save({
      typologyCode,
      status: BacktestJobStatus.QUEUED,
      startedAt: new Date(),
    });

    // Simulated async progression (no distributed job queue in Phase 2
    // — fine for a single-instance deployment) so the console's
    // polling UI has a real queued -> running -> complete lifecycle to
    // observe, not an instantly-resolved job.
    setTimeout(() => void this.runBacktest(job.jobId, typologyCode), 1500);

    return job;
  }

  async getBacktestJob(jobId: string): Promise<AmlTypologyBacktestJob> {
    const job = await this.backtestJobs.findOneBy({ jobId });
    if (!job) throw new NotFoundException(`No backtest job with job_id=${jobId}`);
    return job;
  }

  async promote(
    typologyCode: string,
    dto: { backtest_job_id?: string; reason: string; promoted_by: string },
  ): Promise<AmlTypologyPromotion> {
    const config = await this.requireConfig(typologyCode);

    if (dto.backtest_job_id) {
      const job = await this.backtestJobs.findOneBy({ jobId: dto.backtest_job_id, typologyCode });
      if (!job) {
        throw new BadRequestException(`backtest_job_id ${dto.backtest_job_id} does not exist for typology ${typologyCode}`);
      }
    }

    const latest = await this.versions.findOne({ where: { typologyCode }, order: { version: 'DESC' } });
    const versionToPromote = latest?.version ?? config.productionVersion;

    const promotion = await this.promotions.save({
      typologyCode,
      promotedVersion: versionToPromote,
      backtestJobId: dto.backtest_job_id,
      promotedBy: dto.promoted_by,
      promotedAt: new Date(),
    });
    await this.configs.update({ typologyCode }, { productionVersion: versionToPromote });

    return promotion;
  }

  private async runBacktest(jobId: string, typologyCode: string): Promise<void> {
    await this.backtestJobs.update({ jobId }, { status: BacktestJobStatus.RUNNING });

    const rows = (await this.dataSource.query(
      `SELECT a.recommendation, d.disposition_type
       FROM aml_typology_matches t
       JOIN aml_case_assessments a ON a.case_id = t.case_id
       JOIN aml_dispositions d ON d.case_id = t.case_id
       WHERE t.typology_code = $1`,
      [typologyCode],
    )) as Array<{ recommendation: string; disposition_type: string }>;

    const AGREEMENT_MAP: Record<string, string[]> = {
      clear: ['clear'],
      escalate: ['escalate_senior', 'enhanced_monitoring', 'file_str', 'file_ctr'],
      recommend_str: ['file_str'],
      recommend_ctr: ['file_ctr'],
    };

    const agreements = rows.filter((r) => AGREEMENT_MAP[r.recommendation]?.includes(r.disposition_type)).length;
    const sampleSize = rows.length;

    const comparisonReport: Record<string, unknown> = {
      method:
        'Phase 2 baseline: production agreement rate from historical Case/Disposition data for this typology. Not a shadow-mode re-run of a draft rule-logic edit.',
      sampleSize,
      productionAgreementRate: sampleSize > 0 ? agreements / sampleSize : null,
      computedAt: new Date().toISOString(),
    };

    await this.dataSource.query(
      `UPDATE aml_typology_backtest_jobs SET status = $1, completed_at = $2, comparison_report = $3 WHERE job_id = $4`,
      [BacktestJobStatus.COMPLETE, new Date(), JSON.stringify(comparisonReport), jobId],
    );
  }

  private async requireConfig(typologyCode: string): Promise<AmlTypologyConfig> {
    const config = await this.configs.findOneBy({ typologyCode });
    if (!config) {
      throw new NotFoundException(`No typology config with typology_code=${typologyCode}`);
    }
    return config;
  }
}
