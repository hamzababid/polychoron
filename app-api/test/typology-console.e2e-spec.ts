import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

describe('Typology & Rules Console (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mlroSessionId: string;
  let auditSessionId: string;
  let analystSessionId: string;

  const typologyCode = `test-typology-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dataSource = moduleFixture.get(getConnectionToken());

    const login = async (userId: string) => {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({ user_id: userId }).expect(201);
      return (res.body as { sessionId: string }).sessionId;
    };
    mlroSessionId = await login('demo-mlro-1');
    auditSessionId = await login('demo-model-risk-audit-1');
    analystSessionId = await login('demo-analyst-1');

    await dataSource.query(
      `INSERT INTO aml_typology_configs (typology_code, typology_label, rule_logic_description, active, production_version)
       VALUES ($1, 'Test Typology', 'Original description', true, 1)`,
      [typologyCode],
    );
    await dataSource.query(
      `INSERT INTO aml_typology_config_versions (typology_code, version, rule_logic_description, active, changed_by, change_reason)
       VALUES ($1, 1, 'Original description', true, 'demo-mlro-1', 'Initial seed for test')`,
      [typologyCode],
    );
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM aml_typology_promotions WHERE typology_code = $1', [typologyCode]);
    await dataSource.query('DELETE FROM aml_typology_backtest_jobs WHERE typology_code = $1', [typologyCode]);
    await dataSource.query('DELETE FROM aml_typology_config_versions WHERE typology_code = $1', [typologyCode]);
    await dataSource.query('DELETE FROM aml_typology_configs WHERE typology_code = $1', [typologyCode]);
    await app.close();
  });

  it('denies an analyst entirely', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/typologies')
      .set('x-session-id', analystSessionId)
      .expect(403);
  });

  it('lets model_risk_audit read but not write', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/typologies')
      .set('x-session-id', auditSessionId)
      .expect(200);
    const body = res.body as { typologies: Array<{ typologyCode: string }> };
    expect(body.typologies.some((t) => t.typologyCode === typologyCode)).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/typologies/${typologyCode}/promote`)
      .set('x-session-id', auditSessionId)
      .send({ reason: 'nope', promoted_by: 'demo-model-risk-audit-1' })
      .expect(403);
  });

  it('records an edit and a toggle as separate version-history rows', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/typologies/${typologyCode}`)
      .set('x-session-id', mlroSessionId)
      .send({ rule_logic_description: 'Updated description', change_reason: 'Clarify wording', changed_by: 'demo-mlro-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/typologies/${typologyCode}`)
      .set('x-session-id', mlroSessionId)
      .send({ active: false, change_reason: 'Pausing for review', changed_by: 'demo-mlro-1' })
      .expect(201);

    const historyRes = await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/typologies/${typologyCode}/history`)
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const versions = historyRes.body as Array<{ version: number; active: boolean; changeReason: string }>;
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(versions[0].active).toBe(false);
    expect(versions[0].changeReason).toBe('Pausing for review');
  });

  it('runs a backtest job to completion and lets it be linked at promotion', async () => {
    const startRes = await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/typologies/${typologyCode}/backtest`)
      .set('x-session-id', mlroSessionId)
      .expect(201);
    const jobId = (startRes.body as { jobId: string }).jobId;
    expect((startRes.body as { status: string }).status).toBe('queued');

    let job: { status: string } = { status: 'queued' };
    for (let i = 0; i < 10 && job.status !== 'complete'; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const res = await request(app.getHttpServer())
        .get(`/api/v1/features/aml_detection/typologies/backtest-jobs/${jobId}`)
        .set('x-session-id', mlroSessionId)
        .expect(200);
      job = res.body as { status: string };
    }
    expect(job.status).toBe('complete');

    const promoteRes = await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/typologies/${typologyCode}/promote`)
      .set('x-session-id', mlroSessionId)
      .send({ backtest_job_id: jobId, reason: 'Approved after review', promoted_by: 'demo-mlro-1' })
      .expect(201);
    expect((promoteRes.body as { backtestJobId: string }).backtestJobId).toBe(jobId);

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/typologies')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const listBody = listRes.body as {
      typologies: Array<{ typologyCode: string; productionVersion: number; hasActiveBacktest: boolean }>;
      lastPromotion: { typologyCode: string; promotedVersion: number } | null;
    };
    const updated = listBody.typologies.find((t) => t.typologyCode === typologyCode);
    expect(updated?.productionVersion).toBe(3);
    // The backtest job is already complete by this point, not
    // queued/running — hasActiveBacktest is about a backtest actually
    // in flight, not "has ever been backtested".
    expect(updated?.hasActiveBacktest).toBe(false);
    expect(listBody.lastPromotion?.typologyCode).toBe(typologyCode);
    expect(listBody.lastPromotion?.promotedVersion).toBe(3);
  }, 15_000);

  it('allows a promotion with no linked backtest (flagged client-side, not blocked server-side)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/typologies/${typologyCode}/promote`)
      .set('x-session-id', mlroSessionId)
      .send({ reason: 'Emergency promotion, no backtest run', promoted_by: 'demo-mlro-1' })
      .expect(201);
    expect((res.body as { backtestJobId: string | null }).backtestJobId).toBeFalsy();
  });
});
