import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Repository, DataSource } from 'typeorm';
import { Client } from '@temporalio/client';
import { AppModule } from './../src/app.module.js';
import { AmlCase } from '../src/features/aml-detection/entities/aml-case.entity.js';
import { FeatureCaseEnvelope } from '../src/platform/entities/index.js';
import { TEMPORAL_CLIENT } from '../src/common/temporal/temporal.module.js';

describe('AML Detection ingestion (e2e)', () => {
  let app: INestApplication<App>;
  let caseRepo: Repository<AmlCase>;
  let envelopeRepo: Repository<FeatureCaseEnvelope>;
  let temporalClient: Client;
  let dataSource: DataSource;

  const sourceAlertId = `E2E-ALERT-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    caseRepo = moduleFixture.get(getRepositoryToken(AmlCase));
    envelopeRepo = moduleFixture.get(getRepositoryToken(FeatureCaseEnvelope));
    temporalClient = moduleFixture.get(TEMPORAL_CLIENT);
    dataSource = moduleFixture.get(getConnectionToken());
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a Case + FeatureCaseEnvelope transactionally and starts the Temporal workflow', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/alerts/ingest')
      .send({
        source_alert_id: sourceAlertId,
        source_system: 'CoreTMS-DemoBank',
        customer_id: 'CUST-DEMO-A1',
        account_ids: ['ACC-DEMO-A1001'],
        transaction_refs: ['TXN-A-1001', 'TXN-A-1002', 'TXN-A-1003'],
        rule_fired: 'sub_threshold_structuring',
        risk_tier_hint: 'high',
      })
      .expect(201);

    const body = res.body as { caseId: string; status: string; workflowId: string };
    expect(body.status).toBe('open');
    expect(body.workflowId).toBe(`aml-case-${body.caseId}`);

    const savedCase = await caseRepo.findOneBy({ caseId: body.caseId });
    expect(savedCase).not.toBeNull();
    expect((savedCase!.alert as { source_alert_id: string }).source_alert_id).toBe(sourceAlertId);

    const envelope = await envelopeRepo.findOneBy({ externalCaseRef: body.caseId });
    expect(envelope).not.toBeNull();
    expect(envelope!.featureCode).toBe('aml_detection');
    expect(envelope!.suiteCode).toBe('bfsi');

    // Confirm the workflow actually started and is visible to Temporal
    // (the agent-service worker is expected to be running separately —
    // see TASKS.md's Data & Ingestion test).
    const handle = temporalClient.workflow.getHandle(body.workflowId);
    const description = await handle.describe();
    expect(['RUNNING', 'COMPLETED']).toContain(description.status.name);

    // Terminate before deleting the case row — the real worker
    // processes this workflow asynchronously against real mock-bank/
    // LLM calls, and if it's still running when the case row
    // disappears, its evidence_gathering_activity fails with a
    // foreign-key violation once it gets around to writing
    // aml_evidence_bundles (observed in practice: repeated runs of
    // this test left several permanently-failed orphaned workflows in
    // Temporal). Terminating first guarantees no activity runs against
    // a case row that's about to be deleted.
    if (description.status.name === 'RUNNING') {
      await handle.terminate('e2e test cleanup');
    }

    await dataSource.query('DELETE FROM feature_case_envelopes WHERE external_case_ref = $1', [body.caseId]);
    await dataSource.query('DELETE FROM aml_cases WHERE case_id = $1', [body.caseId]);
  });

  it('rejects an ingestion payload missing required fields', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/alerts/ingest')
      .send({ source_alert_id: 'incomplete' })
      .expect(400);
  });
});
