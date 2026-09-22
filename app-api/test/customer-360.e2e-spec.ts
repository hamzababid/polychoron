import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

const DEMO_TENANT_ID = 'demo-northbridge-bank';

/**
 * specs/suites/bfsi/features/aml-detection/screens/08-customer-360.md —
 * aggregation across two fixture cases for the same customer_id, plus
 * RBAC and the "read-only, no write endpoints" acceptance criterion.
 */
describe('Customer 360 (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let analystSessionId: string;
  let auditSessionId: string;
  const fixtureCaseIds: string[] = [];
  const customerId = `CUST-360-TEST-${Date.now()}`;

  async function createFixtureCase(opts: { accountId: string; disposition?: string }): Promise<string> {
    const rows = (await dataSource.query(
      `INSERT INTO aml_cases (tenant_id, alert, status, closed_at)
       VALUES ($1, $2, 'cleared', now()) RETURNING case_id`,
      [
        DEMO_TENANT_ID,
        JSON.stringify({
          source_alert_id: `FIXTURE-360-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source_system: 'CoreTMS-DemoBank',
          customer_id: customerId,
          account_ids: [opts.accountId],
          transaction_refs: ['TXN-360-1'],
          rule_fired: 'fixture_rule',
          risk_tier_hint: 'high',
        }),
      ],
    )) as Array<{ case_id: string }>;
    const caseId = rows[0].case_id;
    fixtureCaseIds.push(caseId);

    await dataSource.query(
      `INSERT INTO aml_evidence_bundles (case_id, kyc, transaction_timeline, linked_entities, prior_cases, screening_results, agent_version)
       VALUES ($1, $2, '[]', $3, '[]', $4, 'v1')`,
      [
        caseId,
        JSON.stringify({
          customer_name: 'Customer 360 Fixture',
          cnic: '11111-1111111-1',
          declared_occupation: 'Test',
          kyc_risk_rating: 'medium',
          account_opening_date: new Date().toISOString(),
          address: 'Fixture Address',
        }),
        JSON.stringify([{ entity_id: 'ENT-360-SHARED', relationship_type: 'shared_address', account_id: null, notes: null }]),
        JSON.stringify([
          {
            list_source: 'UN Consolidated List',
            matched_name: 'Fixture Match',
            match_confidence: 0.5,
            match_rationale: 'name similarity',
            disposition: 'false_match',
          },
        ]),
      ],
    );
    await dataSource.query(
      `INSERT INTO aml_typology_matches (case_id, typology_code, typology_label, confidence, matched_indicators, plain_language_rationale, agent_version)
       VALUES ($1, 'structuring_subthreshold', 'Structuring', 0.9, '[]', 'fixture rationale', 'v1')`,
      [caseId],
    );
    await dataSource.query(
      `INSERT INTO aml_case_assessments (case_id, risk_score, recommendation, recommendation_confidence, draft_narrative, agent_version)
       VALUES ($1, 70, 'escalate', 0.8, 'fixture narrative', 'v1')`,
      [caseId],
    );
    if (opts.disposition) {
      await dataSource.query(
        `INSERT INTO aml_dispositions (case_id, officer_id, disposition_type, officer_notes)
         VALUES ($1, 'demo-analyst-1', $2, 'fixture notes')`,
        [caseId, opts.disposition],
      );
    }
    return caseId;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    dataSource = moduleFixture.get(getConnectionToken());

    const analystLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ user_id: 'demo-analyst-1' })
      .expect(201);
    analystSessionId = (analystLogin.body as { sessionId: string }).sessionId;

    const auditLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ user_id: 'demo-model-risk-audit-1' })
      .expect(201);
    auditSessionId = (auditLogin.body as { sessionId: string }).sessionId;

    await createFixtureCase({ accountId: 'ACC-360-A', disposition: 'clear' });
    await createFixtureCase({ accountId: 'ACC-360-B' });
  });

  afterAll(async () => {
    for (const caseId of fixtureCaseIds) {
      await dataSource.query('DELETE FROM aml_dispositions WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_case_assessments WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_typology_matches WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_evidence_bundles WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_cases WHERE case_id = $1', [caseId]);
    }
    await app.close();
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get(`/api/v1/features/aml_detection/customers/${customerId}/360`).expect(401);
  });

  it('denies platform.model_risk_audit — not in this screen\'s RBAC list', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/customers/${customerId}/360`)
      .set('x-session-id', auditSessionId)
      .expect(403);
  });

  it('404s for a customer_id with no cases', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/customers/no-such-customer/360`)
      .set('x-session-id', analystSessionId)
      .expect(404);
  });

  it('aggregates accounts, prior cases, linked entities, and screening history across both fixture cases', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/customers/${customerId}/360`)
      .set('x-session-id', analystSessionId)
      .expect(200);

    const body = res.body as {
      customerId: string;
      kyc: { customer_name: string } | null;
      currentRiskScore: number | null;
      accounts: Array<{ accountId: string; caseIds: string[] }>;
      priorCases: Array<{ caseId: string; finalDisposition: string | null }>;
      linkedEntities: Array<{ entity_id: string }>;
      screeningHistory: Array<{ list_source: string }>;
    };

    expect(body.customerId).toBe(customerId);
    expect(body.kyc?.customer_name).toBe('Customer 360 Fixture');
    expect(body.currentRiskScore).toBe(70);
    expect(body.accounts.map((a) => a.accountId).sort()).toEqual(['ACC-360-A', 'ACC-360-B']);
    expect(body.priorCases).toHaveLength(2);
    // Only one entity was seeded, shared identically across both cases'
    // evidence bundles — aggregation must dedupe by entity_id, not
    // double-list it.
    expect(body.linkedEntities).toHaveLength(1);
    expect(body.linkedEntities[0].entity_id).toBe('ENT-360-SHARED');
    expect(body.screeningHistory).toHaveLength(2);
    expect(body.priorCases.some((p) => p.finalDisposition === 'clear')).toBe(true);
  });

  it('has no write route on this path (read-only by construction)', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/customers/${customerId}/360`)
      .set('x-session-id', analystSessionId)
      .expect(404);
  });
});
