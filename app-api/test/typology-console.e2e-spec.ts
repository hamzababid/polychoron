import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

/** screens/06-typology-rules-console.md — Typology lifecycle (v2).
 * Regression runs are seeded as finished platform_eval_runs rows (the
 * KB tests' fixed-vector approach): no live LLM in CI. The one real
 * run is behind RUN_LIVE_LLM_TESTS. */

const RUN_LIVE_LLM_TESTS = process.env.RUN_LIVE_LLM_TESTS === '1';
const BASE = '/api/v1/features/aml_detection/typologies';

interface VersionView {
  version: number;
  status: string;
  typologyLabel: string;
  ruleLogicDescription: string;
  active: boolean;
  changedBy: string;
  changeReason: string;
  candidateKey: string;
}
interface Detail {
  typologyCode: string;
  status: 'live' | 'retired' | 'not_live';
  productionVersion: number | null;
  createdBy: string;
  live: VersionView | null;
  draft: VersionView | null;
  regression: { runId: string; status: string; stale?: boolean } | null;
  goldenCoverage: number;
}

describe('Typology & Rules Console — lifecycle (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mlro: string;
  let audit: string;
  let analyst: string;

  const code = `test_typology_${Date.now()}`;
  const as = (session: string) => ({
    get: (path: string) => request(app.getHttpServer()).get(`${BASE}${path}`).set('x-session-id', session),
    post: (path: string, body: object = {}) => request(app.getHttpServer()).post(`${BASE}${path}`).set('x-session-id', session).send(body),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(`${BASE}${path}`).set('x-session-id', session).send(body),
    delete: (path: string, body: object = {}) =>
      request(app.getHttpServer()).delete(`${BASE}${path}`).set('x-session-id', session).send(body),
  });

  const detail = async (): Promise<Detail> => (await as(mlro).get(`/${code}`).expect(200)).body as Detail;

  /** What the Pattern Matching Agent reads (typology_config_repository.py). */
  const agentCatalogEntry = async () => {
    const rows = (await dataSource.query(
      `SELECT v.version, v.rule_logic_description FROM aml_typology_configs c
       JOIN aml_typology_config_versions v ON v.typology_code = c.typology_code AND v.version = c.production_version
       WHERE c.typology_code = $1 AND v.active = true`,
      [code],
    )) as Array<{ version: number; rule_logic_description: string }>;
    return rows[0] ?? null;
  };

  /** A finished regression run for the draft's current content. */
  const seedRun = async (status: 'passed' | 'failed' = 'passed') => {
    const { draft } = await detail();
    const [{ run_id }] = (await dataSource.query(
      `INSERT INTO platform_eval_runs (feature_code, agent_version_under_test, triggered_by, total_cases, passed, status, completed_at)
       VALUES ('aml_detection', $1, 'demo-mlro-1', 1, 1, $2, now()) RETURNING run_id`,
      [draft!.candidateKey, status],
    )) as Array<{ run_id: string }>;
    return run_id;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    dataSource = moduleFixture.get(getConnectionToken());

    const login = async (userId: string) => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({ user_id: userId }).expect(201);
      return (res.body as { sessionId: string }).sessionId;
    };
    mlro = await login('demo-mlro-1');
    audit = await login('demo-model-risk-audit-1');
    analyst = await login('demo-analyst-1');
  });

  afterAll(async () => {
    // Promoted/superseded rows are immutable outside the explicit
    // maintenance override migration 014 provides for cleanup.
    await dataSource.transaction(async (tx) => {
      await tx.query(`SET LOCAL polychoron.typology_maintenance = 'on'`);
      await tx.query('DELETE FROM aml_typology_promotions WHERE typology_code = $1', [code]);
      await tx.query('DELETE FROM aml_typology_backtest_jobs WHERE typology_code = $1', [code]);
      await tx.query('UPDATE aml_typology_configs SET production_version = NULL WHERE typology_code = $1', [code]);
      await tx.query('DELETE FROM aml_typology_config_versions WHERE typology_code = $1', [code]);
      await tx.query('DELETE FROM aml_typology_configs WHERE typology_code = $1', [code]);
      const runs = `SELECT run_id FROM platform_eval_runs WHERE agent_version_under_test LIKE $1`;
      await tx.query(`DELETE FROM platform_eval_case_results WHERE run_id IN (${runs})`, [`typology:${code}:%`]);
      await tx.query(`DELETE FROM platform_eval_runs WHERE agent_version_under_test LIKE $1`, [`typology:${code}:%`]);
    });
    await app.close();
  });

  it('denies an analyst entirely', async () => {
    await as(analyst).get('').expect(403);
  });

  it('creates a typology as a draft that is not yet live', async () => {
    const res = await as(mlro)
      .post('', {
        typology_code: code,
        typology_label: 'Test typology',
        rule_logic_description: 'Original rule text',
        reason: 'New pattern from FMU circular',
        created_by: 'someone-else',
      })
      .expect(201);
    const created = res.body as Detail;
    expect(created.status).toBe('not_live');
    expect(created.productionVersion).toBeNull();
    expect(created.createdBy).toBe('demo-mlro-1');
    expect(created.draft).toMatchObject({ version: 1, status: 'draft', changeReason: 'New pattern from FMU circular' });
    expect(created.goldenCoverage).toBe(0);
    expect(await agentCatalogEntry()).toBeNull();

    const list = (await as(mlro).get('').expect(200)).body as { typologies: Array<{ typologyCode: string; status: string }> };
    expect(list.typologies.find((t) => t.typologyCode === code)?.status).toBe('not_live');
  });

  it('validates new typology codes', async () => {
    const body = { typology_label: 'x', rule_logic_description: 'y', reason: 'z' };
    await as(mlro).post('', { ...body, typology_code: code }).expect(409);
    await as(mlro).post('', { ...body, typology_code: 'Bad-Code' }).expect(400);
    await as(mlro).post('', { ...body, typology_code: 'no_significant_pattern' }).expect(400);
    await as(mlro).post('', { ...body, typology_code: `${code}_x`, reason: '   ' }).expect(400);
  });

  it('lets model_risk_audit read everything but write nothing', async () => {
    await as(audit).get('').expect(200);
    await as(audit).get(`/${code}`).expect(200);
    await as(audit).get(`/${code}/history`).expect(200);

    await as(audit).post('', { typology_code: `${code}_a`, typology_label: 'x', rule_logic_description: 'y', reason: 'z' }).expect(403);
    await as(audit).post(`/${code}/draft`).expect(403);
    await as(audit).patch(`/${code}/draft`, { change_reason: 'x' }).expect(403);
    await as(audit).delete(`/${code}/draft`, { reason: 'x' }).expect(403);
    await as(audit).post(`/${code}/draft/regression`).expect(403);
    await as(audit).post(`/${code}/backtest`).expect(403);
    await as(audit).post(`/${code}/promote`, { reason: 'x' }).expect(403);
  });

  it('refuses to promote without a passing regression run for the draft', async () => {
    await as(mlro).post(`/${code}/promote`, { reason: 'go live' }).expect(409);
    await seedRun('failed');
    await as(mlro).post(`/${code}/promote`, { reason: 'go live' }).expect(409);
    await as(mlro).post(`/${code}/promote`, { reason: '  ' }).expect(400);
  });

  it('promotes with a passing run, recording reason, run and the session user', async () => {
    const runId = await seedRun();
    const res = await as(mlro)
      .post(`/${code}/promote`, { reason: 'Regression passed', promoted_by: 'someone-else' })
      .expect(201);
    expect(res.body).toMatchObject({
      promotedVersion: 1,
      reason: 'Regression passed',
      evalRunId: runId,
      backtestJobId: null,
      promotedBy: 'demo-mlro-1',
    });

    const d = await detail();
    expect(d.status).toBe('live');
    expect(d.productionVersion).toBe(1);
    expect(d.draft).toBeNull();
    expect(await agentCatalogEntry()).toEqual({ version: 1, rule_logic_description: 'Original rule text' });
  });

  it('keeps draft edits away from the agent until promoted, and invalidates stale runs', async () => {
    const opened = (await as(mlro).post(`/${code}/draft`).expect(201)).body as VersionView;
    expect(opened).toMatchObject({ version: 2, status: 'draft', ruleLogicDescription: 'Original rule text', changeReason: '' });
    await as(mlro).post(`/${code}/draft`).expect(409);

    await as(mlro).post(`/${code}/draft/regression`).expect(400); // no change_reason yet

    await as(mlro)
      .patch(`/${code}/draft`, { rule_logic_description: 'Tightened rule text', change_reason: 'Tighten the window', changed_by: 'x' })
      .expect(200);
    expect(await agentCatalogEntry()).toEqual({ version: 1, rule_logic_description: 'Original rule text' });

    await seedRun();
    expect((await detail()).regression).toMatchObject({ status: 'passed', stale: false });

    // Edited after its run: the run no longer counts.
    await as(mlro).patch(`/${code}/draft`, { rule_logic_description: 'Tightened rule text, again' }).expect(200);
    expect((await detail()).regression).toMatchObject({ status: 'passed', stale: true });
    await as(mlro).post(`/${code}/promote`, { reason: 'go' }).expect(409);
    expect((await detail()).draft?.changedBy).toBe('demo-mlro-1');
  });

  it('promotes the edit with a linked backtest and supersedes the old version', async () => {
    const start = await as(mlro).post(`/${code}/backtest`).expect(201);
    const jobId = (start.body as { jobId: string }).jobId;
    let job = { status: 'queued' };
    for (let i = 0; i < 10 && job.status !== 'complete'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      job = (await as(mlro).get(`/backtest-jobs/${jobId}`).expect(200)).body as { status: string };
    }
    expect(job.status).toBe('complete');

    await seedRun();
    const res = await as(mlro).post(`/${code}/promote`, { backtest_job_id: jobId, reason: 'Backtest and regression clean' }).expect(201);
    expect((res.body as { backtestJobId: string }).backtestJobId).toBe(jobId);

    expect(await agentCatalogEntry()).toEqual({ version: 2, rule_logic_description: 'Tightened rule text, again' });
    const history = (await as(mlro).get(`/${code}/history`).expect(200)).body as {
      versions: VersionView[];
      promotions: Array<{ promotedVersion: number; reason: string }>;
    };
    expect(history.versions.map((v) => [v.version, v.status])).toEqual([
      [2, 'promoted'],
      [1, 'superseded'],
    ]);
    expect(history.promotions.map((p) => p.promotedVersion)).toEqual([2, 1]);

    const list = (await as(mlro).get('').expect(200)).body as { lastPromotion: { typologyCode: string; promotedVersion: number } };
    expect(list.lastPromotion).toMatchObject({ typologyCode: code, promotedVersion: 2 });
  }, 15_000);

  it('discards a draft only with a reason, keeping it in history', async () => {
    await as(mlro).post(`/${code}/draft`).expect(201);
    await as(mlro).delete(`/${code}/draft`, {}).expect(400);
    const discarded = (await as(mlro).delete(`/${code}/draft`, { reason: 'Not needed after all' }).expect(200)).body as VersionView;
    expect(discarded).toMatchObject({ version: 3, status: 'discarded' });
    await as(mlro).patch(`/${code}/draft`, { change_reason: 'x' }).expect(404);
    await as(mlro).delete(`/${code}/draft`, { reason: 'again' }).expect(404);
  });

  it('retires a typology by promoting active=false', async () => {
    await as(mlro).post(`/${code}/draft`).expect(201);
    await as(mlro).patch(`/${code}/draft`, { active: false, change_reason: 'Superseded by a broader typology' }).expect(200);
    await seedRun();
    await as(mlro).post(`/${code}/promote`, { reason: 'Retire' }).expect(201);

    const d = await detail();
    expect(d.status).toBe('retired');
    expect(d.productionVersion).toBe(4);
    expect(await agentCatalogEntry()).toBeNull();
  });

  it('has no in-place edit route and 404s unknown runs', async () => {
    await as(mlro).post(`/${code}`, { rule_logic_description: 'x', change_reason: 'y' }).expect(404);
    await as(mlro).get('/regression-runs/00000000-0000-0000-0000-000000000000').expect(404);
    await as(mlro).get('/no_such_typology').expect(404);
  });

  // Real golden-dataset regression through the agent-service worker —
  // costs an LLM call per golden case. Run manually before a release.
  (RUN_LIVE_LLM_TESTS ? it : it.skip)(
    'runs a real regression against the candidate catalog',
    async () => {
      await as(mlro).post(`/${code}/draft`).expect(201);
      await as(mlro).patch(`/${code}/draft`, { active: true, change_reason: 'Live regression check' }).expect(200);
      const { runId } = (await as(mlro).post(`/${code}/draft/regression`).expect(202)).body as { runId: string };

      let run = { status: 'queued', done: 0, total: null as number | null };
      for (let i = 0; i < 180 && !['passed', 'failed'].includes(run.status); i++) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        run = (await as(mlro).get(`/regression-runs/${runId}`).expect(200)).body as typeof run;
      }
      expect(['passed', 'failed']).toContain(run.status);
      expect(run.done).toBe(run.total);
    },
    16 * 60_000,
  );
});
