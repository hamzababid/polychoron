import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Client, WorkflowNotFoundError } from '@temporalio/client';
import { AmlTypologyConfig } from '../entities/aml-typology-config.entity.js';
import { AmlTypologyConfigVersion } from '../entities/aml-typology-config-version.entity.js';
import { AmlTypologyBacktestJob, BacktestJobStatus } from '../entities/aml-typology-backtest-job.entity.js';
import { AmlTypologyPromotion } from '../entities/aml-typology-promotion.entity.js';
import type { PlatformUser } from '../../../platform/entities/index.js';
import { TEMPORAL_CLIENT } from '../../../common/temporal/temporal.module.js';
import type { CreateTypologyDto, UpdateDraftDto } from '../dto/typology-lifecycle.dto.js';

const FEATURE_CODE = 'aml_detection';
const TASK_QUEUE = 'aml_detection-task-queue';
const REGRESSION_WORKFLOW_PREFIX = 'typology-regression-';
// The Pattern Matching Agent's own "nothing fits" answer — never a
// catalog code.
const RESERVED_CODES = new Set(['no_significant_pattern']);

export type TypologyStatus = 'live' | 'retired' | 'not_live';

export interface DraftSummary {
  version: number;
  typologyLabel: string;
  changedBy: string;
  changedAt: string;
}

export interface TypologyRow {
  typologyCode: string;
  // The live label, or the draft's for a typology that was never promoted.
  typologyLabel: string;
  ruleLogicDescription: string | null;
  status: TypologyStatus;
  productionVersion: number | null;
  killSwitched: boolean;
  draft: DraftSummary | null;
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

export interface VersionView {
  version: number;
  status: AmlTypologyConfigVersion['status'];
  typologyLabel: string;
  ruleLogicDescription: string;
  active: boolean;
  changedBy: string;
  changedAt: string;
  changeReason: string;
  candidateKey: string;
  discardedBy: string | null;
  discardedAt: string | null;
  discardReason: string | null;
}

export interface RegressionRunView {
  runId: string;
  status: 'queued' | 'running' | 'passed' | 'failed' | 'needs_review';
  candidateKey: string | null;
  done: number;
  total: number | null;
  passed: number;
  failed: number;
  triggeredBy: string | null;
  startedAt: string | null;
  completedAt: string | null;
  // Only on GET /{code}: true when the draft changed after this run.
  stale?: boolean;
  results?: Array<{
    scenarioName: string;
    expectedTypology: string | null;
    actualTypology: string | null;
    expectedRecommendation: string | null;
    actualRecommendation: string | null;
    actualConfidence: number | null;
    matchedExpected: boolean;
    notes: string | null;
  }>;
}

export interface TypologyDetail {
  typologyCode: string;
  status: TypologyStatus;
  productionVersion: number | null;
  createdBy: string;
  createdAt: string;
  killSwitched: boolean;
  live: VersionView | null;
  draft: VersionView | null;
  regression: RegressionRunView | null;
  latestBacktest: AmlTypologyBacktestJob | null;
  goldenCoverage: number;
}

export interface TypologyHistory {
  versions: VersionView[];
  promotions: AmlTypologyPromotion[];
}

// Version columns plus the candidate key, computed by the same SQL
// function migration 014's promotion guard uses.
const VERSION_SELECT = `SELECT v.*, aml_typology_candidate_key(v.typology_code, v.version, v.content_hash) AS candidate_key
  FROM aml_typology_config_versions v`;

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * ("Typology lifecycle (v2)"). Every rule the DB enforces (migration
 * 014) is also checked here first, so a request that breaks one gets a
 * clear 4xx instead of a trigger error. */
@Injectable()
export class TypologyConsoleService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlTypologyBacktestJob) private readonly backtestJobs: Repository<AmlTypologyBacktestJob>,
    @InjectRepository(AmlTypologyPromotion) private readonly promotions: Repository<AmlTypologyPromotion>,
    @Inject(TEMPORAL_CLIENT) private readonly temporalClient: Client,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────

  async list(user: PlatformUser): Promise<TypologyConsoleOverview> {
    const [rows, metricRows, activeBacktestRows, lastPromotionRows, killSwitched] = await Promise.all([
      this.dataSource.query(`
        SELECT c.typology_code, c.production_version,
               live.typology_label AS live_label, live.rule_logic_description AS live_description, live.active AS live_active,
               d.version AS draft_version, d.typology_label AS draft_label, d.changed_by AS draft_changed_by,
               d.changed_at AS draft_changed_at
        FROM aml_typology_configs c
        LEFT JOIN aml_typology_config_versions live
          ON live.typology_code = c.typology_code AND live.version = c.production_version
        LEFT JOIN aml_typology_config_versions d
          ON d.typology_code = c.typology_code AND d.status = 'draft'
        ORDER BY c.typology_code
      `) as Promise<Array<Record<string, unknown>>>,
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
        SELECT p.typology_code, v.typology_label, p.promoted_version, p.promoted_by, p.promoted_at
        FROM aml_typology_promotions p
        JOIN aml_typology_config_versions v ON v.typology_code = p.typology_code AND v.version = p.promoted_version
        ORDER BY p.promoted_at DESC
        LIMIT 1
      `) as Promise<
        Array<{ typology_code: string; typology_label: string; promoted_version: number; promoted_by: string; promoted_at: Date }>
      >,
      this.killSwitchedCodes(user.tenantId),
    ]);

    const metricsByCode = new Map(metricRows.map((m) => [m.typology_code, m]));
    const activeBacktestByCode = new Map(activeBacktestRows.map((r) => [r.typology_code, r.status]));

    const typologies = rows.map((r): TypologyRow => {
      const code = r.typology_code as string;
      const m = metricsByCode.get(code);
      const total = m?.total_dispositioned ?? 0;
      const backtestStatus = activeBacktestByCode.get(code);
      const productionVersion = (r.production_version as number | null) ?? null;
      return {
        typologyCode: code,
        typologyLabel: ((r.live_label ?? r.draft_label) as string | null) ?? code,
        ruleLogicDescription: (r.live_description as string | null) ?? null,
        status: statusOf(productionVersion, r.live_active as boolean | null),
        productionVersion,
        killSwitched: killSwitched.has(code),
        draft:
          r.draft_version == null
            ? null
            : {
                version: r.draft_version as number,
                typologyLabel: r.draft_label as string,
                changedBy: r.draft_changed_by as string,
                changedAt: (r.draft_changed_at as Date).toISOString(),
              },
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

  async get(typologyCode: string, user: PlatformUser): Promise<TypologyDetail> {
    const manager = this.dataSource.manager;
    const config = await this.requireConfig(manager, typologyCode);
    const [live, draft, killSwitched, [coverage], [latestBacktest]] = await Promise.all([
      config.productionVersion == null ? null : this.findVersion(manager, typologyCode, config.productionVersion),
      this.findDraft(manager, typologyCode),
      this.killSwitchedCodes(user.tenantId),
      this.dataSource.query(
        `SELECT count(*)::int AS n FROM platform_golden_dataset_cases WHERE feature_code = $1 AND expected_typology = $2`,
        [FEATURE_CODE, typologyCode],
      ) as Promise<Array<{ n: number }>>,
      this.backtestJobs.find({ where: { typologyCode }, order: { startedAt: 'DESC' }, take: 1 }),
    ]);

    let regression: RegressionRunView | null = null;
    if (draft) {
      const [run] = (await this.dataSource.query(
        `SELECT run_id FROM platform_eval_runs
         WHERE feature_code = $1 AND agent_version_under_test LIKE $2
         ORDER BY started_at DESC LIMIT 1`,
        [FEATURE_CODE, `typology:${typologyCode}:v${draft.version}:%`],
      )) as Array<{ run_id: string }>;
      if (run) {
        regression = await this.getRegressionRun(run.run_id, { withResults: false });
        regression.stale = regression.candidateKey !== draft.candidateKey;
      }
    }

    return {
      typologyCode,
      status: statusOf(config.productionVersion, live?.active ?? null),
      productionVersion: config.productionVersion,
      createdBy: config.createdBy,
      createdAt: config.createdAt.toISOString(),
      killSwitched: killSwitched.has(typologyCode),
      live,
      draft,
      regression,
      latestBacktest: latestBacktest ?? null,
      goldenCoverage: coverage.n,
    };
  }

  async getHistory(typologyCode: string): Promise<TypologyHistory> {
    const manager = this.dataSource.manager;
    await this.requireConfig(manager, typologyCode);
    const [versionRows, promotions] = await Promise.all([
      manager.query(`${VERSION_SELECT} WHERE v.typology_code = $1 ORDER BY v.version DESC`, [typologyCode]) as Promise<
        Array<Record<string, unknown>>
      >,
      this.promotions.find({ where: { typologyCode }, order: { promotedAt: 'DESC' } }),
    ]);
    return { versions: versionRows.map(toVersionView), promotions };
  }

  async getRegressionRun(runId: string, opts: { withResults: boolean } = { withResults: true }): Promise<RegressionRunView> {
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new NotFoundException(`No regression run with run_id=${runId}`);
    const [row] = (await this.dataSource.query(
      `SELECT r.run_id, r.status, r.agent_version_under_test, r.total_cases, r.passed, r.failed, r.triggered_by,
              r.started_at, r.completed_at,
              (SELECT count(*)::int FROM platform_eval_case_results c WHERE c.run_id = r.run_id) AS done
       FROM platform_eval_runs r
       WHERE r.run_id = $1 AND r.feature_code = $2 AND r.agent_version_under_test LIKE 'typology:%'`,
      [runId, FEATURE_CODE],
    )) as Array<Record<string, unknown>>;

    if (!row) {
      // The workflow creates the run row in its first activity; until
      // then (or if it died first) ask Temporal.
      try {
        const description = await this.temporalClient.workflow.getHandle(`${REGRESSION_WORKFLOW_PREFIX}${runId}`).describe();
        return emptyRun(runId, description.status.name === 'RUNNING' ? 'queued' : 'failed');
      } catch (err) {
        if (err instanceof WorkflowNotFoundError) throw new NotFoundException(`No regression run with run_id=${runId}`);
        throw err;
      }
    }

    const view: RegressionRunView = {
      runId,
      status: row.status as RegressionRunView['status'],
      candidateKey: row.agent_version_under_test as string,
      done: row.done as number,
      total: row.total_cases as number,
      passed: row.passed as number,
      failed: row.failed as number,
      triggeredBy: row.triggered_by as string,
      startedAt: (row.started_at as Date).toISOString(),
      completedAt: row.completed_at ? (row.completed_at as Date).toISOString() : null,
    };
    if (opts.withResults) {
      const results = (await this.dataSource.query(
        `SELECT g.scenario_name, g.expected_typology, g.expected_recommendation,
                c.actual_typology, c.actual_recommendation, c.actual_confidence, c.matched_expected, c.notes
         FROM platform_eval_case_results c
         JOIN platform_golden_dataset_cases g ON g.case_id = c.golden_case_id
         WHERE c.run_id = $1 ORDER BY g.scenario_name`,
        [runId],
      )) as Array<Record<string, unknown>>;
      view.results = results.map((r) => ({
        scenarioName: r.scenario_name as string,
        expectedTypology: (r.expected_typology as string | null) ?? null,
        actualTypology: (r.actual_typology as string | null) ?? null,
        expectedRecommendation: (r.expected_recommendation as string | null) ?? null,
        actualRecommendation: (r.actual_recommendation as string | null) ?? null,
        actualConfidence: (r.actual_confidence as number | null) ?? null,
        matchedExpected: r.matched_expected as boolean,
        notes: (r.notes as string | null) ?? null,
      }));
    }
    return view;
  }

  // ── Writes ─────────────────────────────────────────────────────────

  /** A new typology starts as a v1 draft; it is not in the agent's
   * catalog until promoted. */
  async create(dto: CreateTypologyDto, user: PlatformUser): Promise<TypologyDetail> {
    const code = dto.typology_code;
    if (RESERVED_CODES.has(code)) throw new BadRequestException(`${code} is reserved`);
    const reason = requireText(dto.reason, 'reason');

    await this.dataSource.transaction(async (tx) => {
      const inserted = (await tx.query(
        `INSERT INTO aml_typology_configs (typology_code, created_by) VALUES ($1, $2)
         ON CONFLICT (typology_code) DO NOTHING RETURNING typology_code`,
        [code, user.userId],
      )) as unknown[];
      if (inserted.length === 0) throw new ConflictException(`Typology ${code} already exists`);
      await tx.query(
        `INSERT INTO aml_typology_config_versions
           (typology_code, version, typology_label, rule_logic_description, active, status, changed_by, changed_at, change_reason)
         VALUES ($1, 1, $2, $3, true, 'draft', $4, now(), $5)`,
        [code, requireText(dto.typology_label, 'typology_label'), requireText(dto.rule_logic_description, 'rule_logic_description'), user.userId, reason],
      );
    });
    return this.get(code, user);
  }

  /** Opens a draft copied from the promoted version (or, for a typology
   * that was never promoted, from its latest version). */
  async openDraft(typologyCode: string, user: PlatformUser): Promise<VersionView> {
    return this.dataSource.transaction(async (tx) => {
      const config = await this.lockConfig(tx, typologyCode);
      if (await this.findDraft(tx, typologyCode)) throw new ConflictException(`Typology ${typologyCode} already has an open draft`);
      const [source] = (await tx.query(
        `SELECT typology_label, rule_logic_description, active, version FROM aml_typology_config_versions
         WHERE typology_code = $1 ORDER BY (version = $2) DESC, version DESC LIMIT 1`,
        [typologyCode, config.productionVersion ?? -1],
      )) as Array<{ typology_label: string; rule_logic_description: string; active: boolean }>;
      const [{ next }] = (await tx.query(
        `SELECT coalesce(max(version), 0) + 1 AS next FROM aml_typology_config_versions WHERE typology_code = $1`,
        [typologyCode],
      )) as Array<{ next: number }>;
      await tx.query(
        `INSERT INTO aml_typology_config_versions
           (typology_code, version, typology_label, rule_logic_description, active, status, changed_by, changed_at, change_reason)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, now(), '')`,
        [typologyCode, next, source.typology_label, source.rule_logic_description, source.active, user.userId],
      );
      return (await this.findDraft(tx, typologyCode))!;
    });
  }

  async updateDraft(typologyCode: string, dto: UpdateDraftDto, user: PlatformUser): Promise<VersionView> {
    return this.dataSource.transaction(async (tx) => {
      await this.lockConfig(tx, typologyCode);
      const draft = await this.requireDraft(tx, typologyCode);
      await tx.query(
        `UPDATE aml_typology_config_versions
         SET typology_label = $1, rule_logic_description = $2, active = $3, change_reason = $4, changed_by = $5, changed_at = now()
         WHERE typology_code = $6 AND version = $7`,
        [
          dto.typology_label !== undefined ? requireText(dto.typology_label, 'typology_label') : draft.typologyLabel,
          dto.rule_logic_description !== undefined
            ? requireText(dto.rule_logic_description, 'rule_logic_description')
            : draft.ruleLogicDescription,
          dto.active ?? draft.active,
          dto.change_reason ?? draft.changeReason,
          user.userId,
          typologyCode,
          draft.version,
        ],
      );
      return (await this.findDraft(tx, typologyCode))!;
    });
  }

  async discardDraft(typologyCode: string, reason: string, user: PlatformUser): Promise<VersionView> {
    const discardReason = requireText(reason, 'reason');
    return this.dataSource.transaction(async (tx) => {
      await this.lockConfig(tx, typologyCode);
      const draft = await this.requireDraft(tx, typologyCode);
      await tx.query(
        `UPDATE aml_typology_config_versions
         SET status = 'discarded', discarded_by = $1, discarded_at = now(), discard_reason = $2
         WHERE typology_code = $3 AND version = $4`,
        [user.userId, discardReason, typologyCode, draft.version],
      );
      return (await this.findVersion(tx, typologyCode, draft.version))!;
    });
  }

  /** Starts the golden-dataset regression against the candidate catalog
   * (production + this draft) on the agent-service worker. Background
   * job — every golden case is real LLM calls. */
  async startRegression(typologyCode: string, user: PlatformUser): Promise<{ runId: string; candidateKey: string }> {
    const manager = this.dataSource.manager;
    await this.requireConfig(manager, typologyCode);
    const draft = await this.requireDraft(manager, typologyCode);
    if (!draft.changeReason.trim()) {
      throw new BadRequestException('Say what changed and why (change_reason) before running the regression');
    }
    const runId = randomUUID();
    await this.temporalClient.workflow.start('TypologyRegressionWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: `${REGRESSION_WORKFLOW_PREFIX}${runId}`,
      args: [
        {
          run_id: runId,
          typology_code: typologyCode,
          version: draft.version,
          tenant_id: user.tenantId,
          triggered_by: user.userId,
        },
      ],
    });
    return { runId, candidateKey: draft.candidateKey };
  }

  /** Constitution rule 15, applied at promotion: the draft must have a
   * passing regression run for its exact current content. One
   * transaction — the draft becomes promoted, the previous promoted
   * version superseded, the pointer moves, the promotion is recorded. */
  async promote(
    typologyCode: string,
    dto: { backtest_job_id?: string; reason: string },
    user: PlatformUser,
  ): Promise<AmlTypologyPromotion> {
    const reason = requireText(dto.reason, 'reason');
    const promotionId = await this.dataSource.transaction(async (tx) => {
      await this.lockConfig(tx, typologyCode);
      const draft = await this.requireDraft(tx, typologyCode);
      if (!draft.changeReason.trim()) throw new BadRequestException('The draft has no change_reason');

      if (dto.backtest_job_id) {
        const [job] = (await tx.query(`SELECT 1 FROM aml_typology_backtest_jobs WHERE job_id = $1 AND typology_code = $2`, [
          dto.backtest_job_id,
          typologyCode,
        ])) as unknown[];
        if (!job) {
          throw new BadRequestException(`backtest_job_id ${dto.backtest_job_id} does not exist for typology ${typologyCode}`);
        }
      }

      const [run] = (await tx.query(
        `SELECT run_id FROM platform_eval_runs
         WHERE feature_code = $1 AND agent_version_under_test = $2 AND status = 'passed'
         ORDER BY completed_at DESC NULLS LAST LIMIT 1`,
        [FEATURE_CODE, draft.candidateKey],
      )) as Array<{ run_id: string }>;
      if (!run) {
        throw new ConflictException(
          `Typology ${typologyCode} v${draft.version} needs a passing golden-dataset regression run for its current content before it can be promoted`,
        );
      }

      const [promotion] = (await tx.query(
        `INSERT INTO aml_typology_promotions (typology_code, promoted_version, backtest_job_id, eval_run_id, reason, promoted_by, promoted_at)
         VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING promotion_id`,
        [typologyCode, draft.version, dto.backtest_job_id ?? null, run.run_id, reason, user.userId],
      )) as Array<{ promotion_id: string }>;
      await tx.query(
        `UPDATE aml_typology_config_versions SET status = 'superseded' WHERE typology_code = $1 AND status = 'promoted'`,
        [typologyCode],
      );
      await tx.query(`UPDATE aml_typology_config_versions SET status = 'promoted' WHERE typology_code = $1 AND version = $2`, [
        typologyCode,
        draft.version,
      ]);
      await tx.query(`UPDATE aml_typology_configs SET production_version = $1 WHERE typology_code = $2`, [
        draft.version,
        typologyCode,
      ]);
      return promotion.promotion_id;
    });
    return this.promotions.findOneByOrFail({ promotionId });
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
    await this.requireConfig(this.dataSource.manager, typologyCode);

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

  // ── Helpers ────────────────────────────────────────────────────────

  private async requireConfig(manager: EntityManager, typologyCode: string): Promise<AmlTypologyConfig> {
    const config = await manager.findOneBy(AmlTypologyConfig, { typologyCode });
    if (!config) throw new NotFoundException(`No typology config with typology_code=${typologyCode}`);
    return config;
  }

  /** Serialises writes to one typology (draft edits vs. promotion). */
  private async lockConfig(tx: EntityManager, typologyCode: string): Promise<AmlTypologyConfig> {
    const [row] = (await tx.query(`SELECT typology_code FROM aml_typology_configs WHERE typology_code = $1 FOR UPDATE`, [
      typologyCode,
    ])) as unknown[];
    if (!row) throw new NotFoundException(`No typology config with typology_code=${typologyCode}`);
    return this.requireConfig(tx, typologyCode);
  }

  private async findVersion(manager: EntityManager, typologyCode: string, version: number): Promise<VersionView | null> {
    const [row] = (await manager.query(`${VERSION_SELECT} WHERE v.typology_code = $1 AND v.version = $2`, [
      typologyCode,
      version,
    ])) as Array<Record<string, unknown>>;
    return row ? toVersionView(row) : null;
  }

  private async findDraft(manager: EntityManager, typologyCode: string): Promise<VersionView | null> {
    const [row] = (await manager.query(`${VERSION_SELECT} WHERE v.typology_code = $1 AND v.status = 'draft'`, [
      typologyCode,
    ])) as Array<Record<string, unknown>>;
    return row ? toVersionView(row) : null;
  }

  private async requireDraft(manager: EntityManager, typologyCode: string): Promise<VersionView> {
    const draft = await this.findDraft(manager, typologyCode);
    if (!draft) throw new NotFoundException(`Typology ${typologyCode} has no open draft`);
    return draft;
  }

  private async killSwitchedCodes(tenantId: string): Promise<Set<string>> {
    const rows = (await this.dataSource.query(
      `SELECT typology_code FROM platform_kill_switch_scopes
       WHERE tenant_id = $1 AND feature_code = $2 AND typology_code IS NOT NULL AND reactivated_at IS NULL`,
      [tenantId, FEATURE_CODE],
    )) as Array<{ typology_code: string }>;
    return new Set(rows.map((r) => r.typology_code));
  }
}

function statusOf(productionVersion: number | null, liveActive: boolean | null): TypologyStatus {
  if (productionVersion == null) return 'not_live';
  return liveActive ? 'live' : 'retired';
}

function requireText(value: string, field: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) throw new BadRequestException(`${field} must not be empty`);
  return trimmed;
}

function toVersionView(r: Record<string, unknown>): VersionView {
  return {
    version: r.version as number,
    status: r.status as VersionView['status'],
    typologyLabel: r.typology_label as string,
    ruleLogicDescription: r.rule_logic_description as string,
    active: r.active as boolean,
    changedBy: r.changed_by as string,
    changedAt: (r.changed_at as Date).toISOString(),
    changeReason: r.change_reason as string,
    candidateKey: r.candidate_key as string,
    discardedBy: (r.discarded_by as string | null) ?? null,
    discardedAt: r.discarded_at ? (r.discarded_at as Date).toISOString() : null,
    discardReason: (r.discard_reason as string | null) ?? null,
  };
}

function emptyRun(runId: string, status: RegressionRunView['status']): RegressionRunView {
  return {
    runId,
    status,
    candidateKey: null,
    done: 0,
    total: null,
    passed: 0,
    failed: 0,
    triggeredBy: null,
    startedAt: null,
    completedAt: null,
  };
}
