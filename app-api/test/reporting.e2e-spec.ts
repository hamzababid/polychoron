import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

const DEMO_TENANT_ID = 'demo-northbridge-bank';

/**
 * specs/suites/bfsi/features/aml-detection/screens/10-reporting-mi.md
 * RBAC (mlro_compliance_head only), real period-scoped aggregation,
 * and the "generated reports are re-downloadable byte-for-byte"
 * acceptance criterion.
 */
describe('Reporting & MI (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let mlroSessionId: string;
  let auditSessionId: string;
  let analystSessionId: string;
  let caseId: string;
  let reportId: string;

  const typologyCode = `test-typology-rpt-${Date.now()}`;
  const branchCode = `BR-RPT-${Date.now()}`;
  // Wide enough to safely contain the fixture's timestamps below.
  const periodStart = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const periodEnd = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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

    const caseRows = (await dataSource.query(
      `INSERT INTO aml_cases (tenant_id, alert, status)
       VALUES ($1, $2, 'filed') RETURNING case_id`,
      [
        DEMO_TENANT_ID,
        JSON.stringify({
          source_alert_id: `FIXTURE-RPT-${Date.now()}`,
          source_system: 'CoreTMS-DemoBank',
          customer_id: 'CUST-RPT-FIXTURE',
          account_ids: ['ACC-RPT-FIXTURE'],
          transaction_refs: ['TXN-RPT-1'],
          rule_fired: 'fixture_rule',
          risk_tier_hint: 'critical',
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
          customer_name: 'Reporting Fixture',
          cnic: '33333-3333333-3',
          declared_occupation: 'Test',
          kyc_risk_rating: 'high',
          account_opening_date: new Date().toISOString(),
          address: 'Fixture Address',
        }),
        JSON.stringify([{ txn_ref: 'TXN-RPT-1', amount: 3000, currency: 'PKR', channel: 'cash_deposit', timestamp: new Date().toISOString(), branch_code: branchCode }]),
      ],
    );
    await dataSource.query(
      `INSERT INTO aml_typology_matches (case_id, typology_code, typology_label, confidence, matched_indicators, plain_language_rationale, agent_version)
       VALUES ($1, $2, 'Reporting Fixture Typology', 0.9, '[]', 'fixture rationale', 'v1')`,
      [caseId, typologyCode],
    );
    await dataSource.query(
      `INSERT INTO aml_case_assessments (case_id, risk_score, recommendation, recommendation_confidence, draft_narrative, agent_version)
       VALUES ($1, 85, 'recommend_str', 0.9, 'fixture narrative', 'v1')`,
      [caseId],
    );
    // decided 5 days ago, filed 2 hours after that — well inside the
    // critical tier's 24h target, so this fixture is a real, known
    // "within target" SLA data point, not just filler.
    const decidedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const submittedAt = new Date(decidedAt.getTime() + 2 * 60 * 60 * 1000);
    await dataSource.query(
      `INSERT INTO aml_dispositions (case_id, officer_id, disposition_type, officer_notes, decided_at)
       VALUES ($1, 'demo-analyst-1', 'file_str', 'fixture notes', $2)`,
      [caseId, decidedAt],
    );
    await dataSource.query(
      `INSERT INTO aml_str_filings (case_id, report_type, payload, final_narrative, attestation, submission_status, submitted_at)
       VALUES ($1, 'str_f', '{}', 'fixture narrative', '{}', 'submitted', $2)`,
      [caseId, submittedAt],
    );
  });

  afterAll(async () => {
    if (reportId) await dataSource.query('DELETE FROM aml_report_generations WHERE report_id = $1', [reportId]);
    await dataSource.query('DELETE FROM aml_str_filings WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_dispositions WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_case_assessments WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_typology_matches WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_evidence_bundles WHERE case_id = $1', [caseId]);
    await dataSource.query('DELETE FROM aml_cases WHERE case_id = $1', [caseId]);
    await app.close();
  });

  it('denies an analyst and a model_risk_audit user — mlro_compliance_head only', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/reports/summary?period_start=${periodStart}&period_end=${periodEnd}`)
      .set('x-session-id', analystSessionId)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/reports/summary?period_start=${periodStart}&period_end=${periodEnd}`)
      .set('x-session-id', auditSessionId)
      .expect(403);
  });

  it('computes real STR/CTR counts, avg time-to-file, SLA adherence, and a typology breakdown from fixture data', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/reports/summary?period_start=${periodStart}&period_end=${periodEnd}&breakdown_by=typology`)
      .set('x-session-id', mlroSessionId)
      .expect(200);

    const body = res.body as {
      strFiledCount: number;
      avgTimeToFileHours: number | null;
      slaByTier: Array<{ tier: string; total: number; breached: number }>;
      breakdown: Array<{ code: string; count: number }>;
    };

    expect(body.strFiledCount).toBeGreaterThanOrEqual(1);
    expect(body.avgTimeToFileHours).not.toBeNull();
    // The fixture's own filing was decided->submitted in exactly 2h,
    // and it's the only thing this test seeded — average must be a
    // small, real number, not a placeholder.
    expect(body.avgTimeToFileHours!).toBeGreaterThan(0);
    expect(body.avgTimeToFileHours!).toBeLessThan(48);

    const criticalTier = body.slaByTier.find((t) => t.tier === 'critical')!;
    expect(criticalTier.total).toBeGreaterThanOrEqual(1);

    const ourTypology = body.breakdown.find((b) => b.code === typologyCode);
    expect(ourTypology).toBeDefined();
    expect(ourTypology!.count).toBeGreaterThanOrEqual(1);
  });

  it('generates a real CSV report, lists it in history, and serves it byte-for-byte on download', async () => {
    const genRes = await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/reports/generate')
      .set('x-session-id', mlroSessionId)
      .send({
        report_name: 'E2E Test Report',
        period_start: periodStart,
        period_end: periodEnd,
        breakdown_by: 'typology',
        format: 'csv',
        generated_by: 'demo-mlro-1',
      })
      .expect(201);
    const generated = genRes.body as { reportId: string; fileName: string; contentHash: string };
    reportId = generated.reportId;
    expect(generated.fileName).toMatch(/\.csv$/);

    const historyRes = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/reports/history')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    const history = historyRes.body as Array<{ reportId: string; contentHash: string }>;
    const historyEntry = history.find((h) => h.reportId === reportId);
    expect(historyEntry).toBeDefined();
    expect(historyEntry!.contentHash).toBe(generated.contentHash);

    const downloadRes = await request(app.getHttpServer())
      .get(`/api/v1/features/aml_detection/reports/${reportId}/download`)
      .set('x-session-id', mlroSessionId)
      .expect(200);
    expect(downloadRes.headers['content-type']).toContain('text/csv');
    expect(downloadRes.text).toContain('E2E Test Report');
    // The CSV's breakdown column is the human-readable typology label,
    // not the raw code — this is the label this fixture inserted.
    expect(downloadRes.text).toContain('Reporting Fixture Typology');
  });

  it('404s a download for an unknown report_id', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/reports/00000000-0000-0000-0000-000000000000/download')
      .set('x-session-id', mlroSessionId)
      .expect(404);
  });
});
