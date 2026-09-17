import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { Client } from '@temporalio/client';
import { AppModule } from './../src/app.module.js';
import { AmlCase } from '../src/features/aml-detection/entities/aml-case.entity.js';
import { TEMPORAL_CLIENT } from '../src/common/temporal/temporal.module.js';

/**
 * This suite drives a real InboundAlert through the real
 * AmlDetectionWorkflow — real mock-bank HTTP calls and real OpenAI
 * calls via agent-service's worker (TASKS.md's Agent Chain task test:
 * "running the workflow against both seed scenarios produces
 * plausible output"), then records a real Disposition and confirms the
 * human-checkpoint signal resumes it to completion.
 *
 * Requires, separately running: `docker compose -f infra/docker-compose.yml up -d`,
 * agent-service's mock-bank app (`uvicorn app.main:app --port 8001`),
 * and its Temporal worker (`python -m app.features.aml_detection.worker`)
 * with a real OPENAI_API_KEY configured. Because of the LLM cost and
 * latency this involves, it's opt-in rather than part of the default
 * CI run — set RUN_LIVE_LLM_TESTS=1 to include it.
 */
const describeLive = process.env.RUN_LIVE_LLM_TESTS ? describe : describe.skip;

describeLive('AML disposition — full live workflow (e2e)', () => {
  let app: INestApplication<App>;
  let caseRepo: Repository<AmlCase>;
  let temporalClient: Client;
  let dataSource: DataSource;
  let complianceOfficerSessionId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    caseRepo = moduleFixture.get(getRepositoryToken(AmlCase));
    temporalClient = moduleFixture.get(TEMPORAL_CLIENT);
    dataSource = moduleFixture.get(getConnectionToken());

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ user_id: 'demo-compliance-officer-1' })
      .expect(201);
    complianceOfficerSessionId = (loginRes.body as { sessionId: string }).sessionId;
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs Scenario A end to end and resolves via a human disposition', async () => {
    const sourceAlertId = `LIVE-E2E-A-${Date.now()}`;

    const ingestRes = await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/alerts/ingest')
      .send({
        source_alert_id: sourceAlertId,
        source_system: 'CoreTMS-DemoBank',
        customer_id: 'CUST-DEMO-A1',
        account_ids: ['ACC-DEMO-A1001'],
        transaction_refs: ['TXN-A-1001', 'TXN-A-1002', 'TXN-A-1003'],
        rule_fired: 'sub_threshold_cash_structuring',
        risk_tier_hint: 'high',
      })
      .expect(201);

    const { caseId, workflowId } = ingestRes.body as { caseId: string; workflowId: string };
    const handle = temporalClient.workflow.getHandle(workflowId);

    // Poll until the workflow has produced its assessment and is
    // paused at the human checkpoint (the third activity can take
    // several seconds for a real LLM call).
    let sawAssessment = false;
    for (let i = 0; i < 30; i++) {
      const rows = (await dataSource.query('SELECT recommendation FROM aml_case_assessments WHERE case_id = $1', [
        caseId,
      ])) as Array<{ recommendation: string }>;
      if (rows.length > 0) {
        sawAssessment = true;
        expect(rows[0].recommendation).toBe('recommend_str');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    expect(sawAssessment).toBe(true);

    const dispositionRes = await request(app.getHttpServer())
      .post(`/api/v1/features/aml_detection/cases/${caseId}/disposition`)
      .set('x-session-id', complianceOfficerSessionId)
      .send({
        officer_id: 'demo-compliance-officer-1',
        disposition_type: 'file_str',
        officer_notes: 'e2e test disposition',
      })
      .expect(201);
    expect((dispositionRes.body as { status: string }).status).toBe('pending_filing');

    const result = await handle.result();
    expect((result as { disposition: { disposition_type: string } }).disposition.disposition_type).toBe('file_str');

    const savedCase = await caseRepo.findOneBy({ caseId });
    expect(savedCase?.status).toBe('pending_filing');
  }, 60_000);
});
