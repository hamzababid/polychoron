import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

const DEMO_TENANT_ID = 'demo-northbridge-bank';

/**
 * specs/suites/bfsi/features/aml-detection/screens/09-model-governance-audit.md
 * RBAC across mlro_compliance_head (full) / model_risk_audit
 * (read-only, all four GETs) / external_examiner (read-only, sampling
 * only — the screen's own acceptance criterion) / analyst (no access).
 */
describe('Model Governance & Audit (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mlroSessionId: string;
  let auditSessionId: string;
  let examinerSessionId: string;
  let analystSessionId: string;
  let caseId: string;

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
    examinerSessionId = await login('demo-external-examiner-1');
    analystSessionId = await login('demo-analyst-1');

    const caseRows = (await dataSource.query(
      `INSERT INTO aml_cases (tenant_id, alert, status, closed_at)
       VALUES ($1, $2, 'cleared', now()) RETURNING case_id`,
      [
        DEMO_TENANT_ID,
        JSON.stringify({
          source_alert_id: `FIXTURE-GOV-${Date.now()}`,
          source_system: 'CoreTMS-DemoBank',
          customer_id: 'CUST-GOV-FIXTURE',
          account_ids: ['ACC-GOV-FIXTURE'],
          transaction_refs: ['TXN-GOV-1'],
          rule_fired: 'fixture_rule',
          risk_tier_hint: 'medium',
        }),
      ],
    )) as Array<{ case_id: string }>;
    caseId = caseRows[0].case_id;

    await dataSource.query(
      `INSERT INTO aml_evidence_bundles (case_id, kyc, transaction_timeline, linked_entities, prior_cases, screening_results, agent_version)
       VALUES ($1, $2, $3, '[]', '[]', '[]', 'v1')`,
      [
        caseId,
        JSON.stringify({
          customer_name: 'Governance Fixture',
          cnic: '22222-2222222-2',
          declared_occupation: 'Test',
          kyc_risk_rating: 'medium',
          account_opening_date: new Date().toISOString(),
          address: 'Fixture Address',
        }),
        JSON.stringify([{ txn_ref: 'TXN-GOV-1', amount: 1000, currency: 'PKR', channel: 'cash_deposit', timestamp: new Date().toISOString(), branch_code: 'BR-GOV-01' }]),
      ],
    );
    await dataSource.query(
      `INSERT INTO aml_typology_matches (case_id, typology_code, typology_label, confidence, matched_indicators, plain_language_rationale, agent_version)
       VALUES ($1, 'structuring_subthreshold', 'Structuring', 0.9, '[]', 'fixture rationale', 'v1')`,
      [caseId],
    );
    await dataSource.query(
      `INSERT INTO aml_dispositions (case_id, officer_id, disposition_type, officer_notes)
       VALUES ($1, 'demo-analyst-1', 'clear', 'fixture notes')`,
      [caseId],
    );
  });

  afterAll(async () => {
    await dataSource.query('DELETE FROM aml_sampling_reviews WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_dispositions WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_typology_matches WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_evidence_bundles WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_cases WHERE case_id = $1', [caseId]);
    await app.close();
  });

  it('denies an analyst entirely', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/sampling')
      .set('x-session-id', analystSessionId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/consistency')
      .set('x-session-id', analystSessionId)
      .expect(403);
  });

  it('external_examiner reads sampling but not consistency/model-versions/data-lineage', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/sampling')
      .set('x-session-id', examinerSessionId)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/consistency')
      .set('x-session-id', examinerSessionId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/model-versions')
      .set('x-session-id', examinerSessionId)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/data-lineage')
      .set('x-session-id', examinerSessionId)
      .expect(403);
  });

  it('external_examiner cannot write a review', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/governance/sampling/${caseId}/review`)
      .set('x-session-id', examinerSessionId)
      .send({ reviewer_id: 'demo-external-examiner-1', reviewer_agreed: true })
      .expect(403);
  });

  it('model_risk_audit reads all four GETs but cannot write a review', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/sampling')
      .set('x-session-id', auditSessionId)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/consistency')
      .set('x-session-id', auditSessionId)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/model-versions')
      .set('x-session-id', auditSessionId)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/data-lineage')
      .set('x-session-id', auditSessionId)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/governance/sampling/${caseId}/review`)
      .set('x-session-id', auditSessionId)
      .send({ reviewer_id: 'demo-model-risk-audit-1', reviewer_agreed: true })
      .expect(403);
  });

  it('consistency breaks STR conversion out by typology and branch from real data', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/consistency')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const body = res.body as { rows: Array<{ typologyCode: string; branchCode: string; sampleSize: number }> };
    const row = body.rows.find((r) => r.branchCode === 'BR-GOV-01' && r.typologyCode === 'structuring_subthreshold');
    expect(row).toBeDefined();
    expect(row!.sampleSize).toBeGreaterThanOrEqual(1);
  });

  it('mlro_compliance_head can record a sampling review, which then shows up in recentReviews and is rejected on a second attempt', async () => {
    const reviewRes = await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/governance/sampling/${caseId}/review`)
      .set('x-session-id', mlroSessionId)
      .send({ reviewer_id: 'demo-mlro-1', reviewer_agreed: false, reviewer_notes: 'Disagree — should have escalated' })
      .expect(201);
    const review = reviewRes.body as { caseId: string; originalDisposition: string; reviewerAgreed: boolean };
    expect(review.caseId).toBe(caseId);
    expect(review.originalDisposition).toBe('clear');
    expect(review.reviewerAgreed).toBe(false);

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/governance/sampling/${caseId}/review`)
      .set('x-session-id', mlroSessionId)
      .send({ reviewer_id: 'demo-mlro-1', reviewer_agreed: true })
      .expect(400);

    const overviewRes = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/governance/sampling')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const overview = overviewRes.body as { recentReviews: Array<{ caseId: string }>; pendingReview: Array<{ caseId: string }> };
    expect(overview.recentReviews.some((r) => r.caseId === caseId)).toBe(true);
    expect(overview.pendingReview.some((p) => p.caseId === caseId)).toBe(false);
  });

  it('404s a review for a case with no disposition', async () => {
    const noDispositionRows = (await dataSource.query(
      `INSERT INTO aml_cases (tenant_id, alert, status)
       VALUES ($1, $2, 'open') RETURNING case_id`,
      [
        DEMO_TENANT_ID,
        JSON.stringify({
          source_alert_id: `FIXTURE-GOV-NODISP-${Date.now()}`,
          source_system: 'CoreTMS-DemoBank',
          customer_id: 'CUST-GOV-FIXTURE-2',
          account_ids: [],
          transaction_refs: [],
          rule_fired: 'fixture_rule',
        }),
      ],
    )) as Array<{ case_id: string }>;
    const noDispositionCaseId = noDispositionRows[0].case_id;

    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/governance/sampling/${noDispositionCaseId}/review`)
      .set('x-session-id', mlroSessionId)
      .send({ reviewer_id: 'demo-mlro-1', reviewer_agreed: true })
      .expect(404);

    await dataSource.query('DELETE FROM aml_cases WHERE case_id = $1', [noDispositionCaseId]);
  });
});
