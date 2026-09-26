import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

/**
 * specs/platform/11-evals-and-guardrails-framework.md, guardrail G6.
 * RBAC: aml_detection.mlro_compliance_head full;
 * platform.model_risk_audit read-only; analyst no access — same
 * pattern as the Typology Console.
 */
describe('Kill Switch (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mlroSessionId: string;
  let auditSessionId: string;
  let analystSessionId: string;

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
  });

  afterAll(async () => {
    await dataSource.query(
      `DELETE FROM platform_kill_switch_scopes WHERE tenant_id = 'demo-northbridge-bank' AND reason LIKE 'e2e test%'`,
    );
    await app.close();
  });

  it('denies an analyst entirely', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', analystSessionId)
      .expect(403);
  });

  it('lets model_risk_audit read but not disable', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', auditSessionId)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', auditSessionId)
      .send({ reason: 'e2e test — should be denied', disabled_by: 'demo-model-risk-audit-1' })
      .expect(403);
  });

  it('lets mlro disable a single typology, then reactivate it', async () => {
    const disableRes = await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', mlroSessionId)
      .send({ typology_code: 'structuring_subthreshold', reason: 'e2e test — pausing for review', disabled_by: 'demo-mlro-1' })
      .expect(201);
    const scopeId = (disableRes.body as { scopeId: string }).scopeId;
    expect((disableRes.body as { typologyCode: string }).typologyCode).toBe('structuring_subthreshold');

    const listRes = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const active = listRes.body as Array<{ scopeId: string; typologyCode: string | null }>;
    expect(active.some((s) => s.scopeId === scopeId)).toBe(true);

    // A second disable on the same scope is rejected — no duplicate
    // active kill switches for the same (tenant, feature, typology).
    await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', mlroSessionId)
      .send({ typology_code: 'structuring_subthreshold', reason: 'e2e test — duplicate', disabled_by: 'demo-mlro-1' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/kill-switch/${scopeId}/reactivate`)
      .set('x-session-id', mlroSessionId)
      .send({ reactivated_by: 'demo-mlro-1' })
      .expect(201);

    const listAfterRes = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const activeAfter = listAfterRes.body as Array<{ scopeId: string }>;
    expect(activeAfter.some((s) => s.scopeId === scopeId)).toBe(false);
  });

  it('rejects reactivating an already-reactivated scope', async () => {
    const disableRes = await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/kill-switch')
      .set('x-session-id', mlroSessionId)
      .send({ typology_code: 'deposit_velocity_shift', reason: 'e2e test — double reactivate check', disabled_by: 'demo-mlro-1' })
      .expect(201);
    const scopeId = (disableRes.body as { scopeId: string }).scopeId;

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/kill-switch/${scopeId}/reactivate`)
      .set('x-session-id', mlroSessionId)
      .send({ reactivated_by: 'demo-mlro-1' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/kill-switch/${scopeId}/reactivate`)
      .set('x-session-id', mlroSessionId)
      .send({ reactivated_by: 'demo-mlro-1' })
      .expect(400);
  });
});
