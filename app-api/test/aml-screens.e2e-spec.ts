import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

const DEMO_TENANT_ID = 'demo-northbridge-bank';

/**
 * Exercises the screen-facing endpoints added for TASKS.md's
 * "AML Detection — Phase 1 (Screens)" — no LLM calls here, this is
 * pure CRUD/RBAC over fixture rows this suite creates and tears down
 * itself, so it's fast, part of the default suite, and re-runnable
 * without depending on the shared dev database's seed-scenario state.
 */
describe('AML screens (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let analystSessionId: string;
  let complianceOfficerSessionId: string;
  const fixtureCaseIds: string[] = [];

  async function createFixtureCase(opts: { status: string; withAssessment: boolean }): Promise<string> {
    const rows = (await dataSource.query(
      `INSERT INTO aml_cases (tenant_id, alert, status)
       VALUES ($1, $2, $3) RETURNING case_id`,
      [
        DEMO_TENANT_ID,
        JSON.stringify({
          source_alert_id: `FIXTURE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          source_system: 'CoreTMS-DemoBank',
          customer_id: 'CUST-DEMO-A1',
          account_ids: ['ACC-DEMO-FIXTURE'],
          transaction_refs: ['TXN-FIXTURE-1'],
          rule_fired: 'fixture_rule',
          risk_tier_hint: 'high',
        }),
        opts.status,
      ],
    )) as Array<{ case_id: string }>;
    const caseId = rows[0].case_id;
    fixtureCaseIds.push(caseId);

    if (opts.withAssessment) {
      await dataSource.query(
        `INSERT INTO aml_evidence_bundles (case_id, kyc, transaction_timeline, linked_entities, prior_cases, screening_results, agent_version)
         VALUES ($1, $2, '[]', '[]', '[]', '[]', 'v1')`,
        [
          caseId,
          JSON.stringify({
            customer_name: 'Fixture Customer',
            cnic: '00000-0000000-0',
            declared_occupation: 'Test',
            kyc_risk_rating: 'medium',
            account_opening_date: new Date().toISOString(),
            address: 'Fixture Address',
          }),
        ],
      );
      await dataSource.query(
        `INSERT INTO aml_typology_matches (case_id, typology_code, typology_label, confidence, matched_indicators, plain_language_rationale, agent_version)
         VALUES ($1, 'structuring_subthreshold', 'Structuring', 0.9, '[]', 'fixture rationale', 'v1')`,
        [caseId],
      );
      await dataSource.query(
        `INSERT INTO aml_case_assessments (case_id, risk_score, recommendation, recommendation_confidence, draft_narrative, str_fields_draft, agent_version)
         VALUES ($1, 85, 'recommend_str', 0.9, 'fixture narrative', $2, 'v1')`,
        [
          caseId,
          JSON.stringify({
            party_name: 'Fixture Customer',
            party_cnic: '00000-0000000-0',
            party_address: 'Fixture Address',
            party_occupation: 'Test',
            account_ids: ['ACC-DEMO-FIXTURE'],
            transaction_refs: ['TXN-FIXTURE-1'],
            total_amount: 5000000,
            currency: 'PKR',
            typology_tag: 'structuring_subthreshold',
            reporting_entity: 'PK-DEMO-BANK-001',
          }),
        ],
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

    const officerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ user_id: 'demo-compliance-officer-1' })
      .expect(201);
    complianceOfficerSessionId = (officerLogin.body as { sessionId: string }).sessionId;
  });

  afterAll(async () => {
    for (const caseId of fixtureCaseIds) {
      await dataSource.query('DELETE FROM aml_filing_edits WHERE case_id = $1', [caseId]);
      await dataSource.query(
        `DELETE FROM aml_fmu_followups WHERE filing_id IN (SELECT filing_id FROM aml_str_filings WHERE case_id = $1)`,
        [caseId],
      );
      await dataSource.query('DELETE FROM aml_str_filings WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_dispositions WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_case_assessments WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_typology_matches WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_evidence_bundles WHERE case_id = $1', [caseId]);
      await dataSource.query('DELETE FROM aml_cases WHERE case_id = $1', [caseId]);
    }
    await app.close();
  });

  describe('Alert Queue', () => {
    it('rejects an unauthenticated request', async () => {
      await request(app.getHttpServer()).get('/api/v1/features/aml_detection/alerts').expect(401);
    });

    it('lists alerts with pagination for a logged-in analyst', async () => {
      await createFixtureCase({ status: 'open', withAssessment: true });

      const res = await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/alerts')
        .set('x-session-id', analystSessionId)
        .expect(200);

      const body = res.body as { items: unknown[]; total: number; page: number; pageSize: number };
      expect(body.total).toBeGreaterThanOrEqual(1);
      expect(body.items.length).toBeGreaterThan(0);
      expect(body.page).toBe(1);
    });

    it('filters by risk_tier', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/alerts')
        .query({ risk_tier: 'critical' })
        .set('x-session-id', analystSessionId)
        .expect(200);

      const body = res.body as { items: Array<{ riskScore: number }> };
      for (const item of body.items) {
        expect(item.riskScore).toBeGreaterThanOrEqual(80);
      }
    });

    it('lets an analyst claim an open alert', async () => {
      const caseId = await createFixtureCase({ status: 'open', withAssessment: false });

      const claimRes = await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/alerts/${caseId}/claim`)
        .set('x-session-id', analystSessionId)
        .expect(201);
      expect((claimRes.body as { assignedAnalystId: string }).assignedAnalystId).toBe('demo-analyst-1');
    });
  });

  describe('Case Workspace', () => {
    it('returns full case detail including evidence and assessment', async () => {
      const caseId = await createFixtureCase({ status: 'open', withAssessment: true });

      const detailRes = await request(app.getHttpServer())
        .get(`/api/v1/features/aml_detection/cases/${caseId}`)
        .set('x-session-id', analystSessionId)
        .expect(200);
      const detail = detailRes.body as { caseId: string; evidence: unknown; assessment: unknown };
      expect(detail.caseId).toBe(caseId);
      expect(detail.evidence).not.toBeNull();
      expect(detail.assessment).not.toBeNull();
    });

    it('returns the activity log (empty for a fixture case with no agent invocations)', async () => {
      const caseId = await createFixtureCase({ status: 'open', withAssessment: true });

      const logRes = await request(app.getHttpServer())
        .get(`/api/v1/features/aml_detection/cases/${caseId}/activity-log`)
        .set('x-session-id', analystSessionId)
        .expect(200);
      expect(Array.isArray(logRes.body)).toBe(true);
    });
  });

  describe('Filing Console RBAC', () => {
    it('returns 403 for an analyst', async () => {
      const caseId = await createFixtureCase({ status: 'pending_filing', withAssessment: true });

      await request(app.getHttpServer())
        .get(`/api/v1/features/aml_detection/cases/${caseId}/filing-draft`)
        .set('x-session-id', analystSessionId)
        .expect(403);
    });

    it('lets a compliance officer draft, attest, and submit a filing', async () => {
      const caseId = await createFixtureCase({ status: 'pending_filing', withAssessment: true });

      const draftRes = await request(app.getHttpServer())
        .get(`/api/v1/features/aml_detection/cases/${caseId}/filing-draft`)
        .set('x-session-id', complianceOfficerSessionId)
        .expect(200);
      const draft = draftRes.body as { strFieldsDraft: Record<string, unknown>; narrative: string };
      expect(draft.strFieldsDraft).toBeDefined();

      const attestRes = await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/cases/${caseId}/filing/attest`)
        .set('x-session-id', complianceOfficerSessionId)
        .send({
          officer_id: 'demo-compliance-officer-1',
          officer_name: 'Bilal Siddiqui',
          officer_role: 'senior_officer_l2',
          tipping_off_checklist_complete: true,
          attestation_confirmed: true,
        })
        .expect(201);
      expect((attestRes.body as { submissionStatus: string }).submissionStatus).toBe('draft');

      const submitRes = await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/cases/${caseId}/filing/submit`)
        .set('x-session-id', complianceOfficerSessionId)
        .expect(201);
      const submitted = submitRes.body as { submissionStatus: string; goamlReference: string };
      expect(submitted.submissionStatus).toBe('submitted');
      expect(submitted.goamlReference).toMatch(/^GOAML-DEMO-/);
    });

    it('refuses to submit without a completed attestation', async () => {
      const caseId = await createFixtureCase({ status: 'pending_filing', withAssessment: true });

      await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/cases/${caseId}/filing/attest`)
        .set('x-session-id', complianceOfficerSessionId)
        .send({
          officer_id: 'demo-compliance-officer-1',
          officer_name: 'Bilal Siddiqui',
          officer_role: 'senior_officer_l2',
          tipping_off_checklist_complete: true,
          attestation_confirmed: false,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/cases/${caseId}/filing/submit`)
        .set('x-session-id', complianceOfficerSessionId)
        .expect(403);
    });
  });

  describe('goAML Tracker', () => {
    it('lists submitted filings and returns 403 for an analyst', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/filings')
        .set('x-session-id', analystSessionId)
        .expect(403);

      const res = await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/filings')
        .set('x-session-id', complianceOfficerSessionId)
        .expect(200);
      const body = res.body as { items: Array<{ filingId: string; submissionStatus: string }>; total: number };
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    it('simulates acknowledgment on a submitted filing', async () => {
      const caseId = await createFixtureCase({ status: 'pending_filing', withAssessment: true });
      await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/cases/${caseId}/filing/attest`)
        .set('x-session-id', complianceOfficerSessionId)
        .send({
          officer_id: 'demo-compliance-officer-1',
          officer_name: 'Bilal Siddiqui',
          officer_role: 'senior_officer_l2',
          tipping_off_checklist_complete: true,
          attestation_confirmed: true,
        })
        .expect(201);
      const submitRes = await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/cases/${caseId}/filing/submit`)
        .set('x-session-id', complianceOfficerSessionId)
        .expect(201);
      const filingsRes = await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/filings')
        .query({ page_size: 100 })
        .set('x-session-id', complianceOfficerSessionId)
        .expect(200);
      const submittedFiling = (filingsRes.body as { items: Array<{ filingId: string; caseId: string }> }).items.find(
        (f) => f.caseId === caseId,
      );
      expect(submittedFiling).toBeDefined();
      expect((submitRes.body as { submissionStatus: string }).submissionStatus).toBe('submitted');

      const ackRes = await request(app.getHttpServer())
        .post(`/api/v1/features/aml_detection/filings/${submittedFiling!.filingId}/simulate-acknowledgment`)
        .set('x-session-id', complianceOfficerSessionId)
        .expect(201);
      expect((ackRes.body as { submissionStatus: string }).submissionStatus).toBe('acknowledged');
    });
  });

  describe('Dashboard', () => {
    it('returns the four top-line figures plus the branch heat-map', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/reports/summary-basic')
        .set('x-session-id', analystSessionId)
        .expect(200);

      const body = res.body as {
        openAlertsByTier: Record<string, number>;
        strCtrVolumeThisPeriod: { str: number; ctr: number };
        agingAlertsCount: number;
        agentVsHumanOverrideRate: number;
        branchRiskHeatmap: unknown[];
      };
      expect(body.openAlertsByTier).toBeDefined();
      expect(typeof body.agingAlertsCount).toBe('number');
      expect(typeof body.agentVsHumanOverrideRate).toBe('number');
      expect(Array.isArray(body.branchRiskHeatmap)).toBe(true);
    });
  });
});
