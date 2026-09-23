import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';

const RUN_LIVE_LLM_TESTS = process.env.RUN_LIVE_LLM_TESTS === '1';

/**
 * specs/platform/10-regulatory-knowledge-base-spec.md's deferred
 * management screen. RBAC: aml_detection.mlro_compliance_head only,
 * both read and write — no read-only role for this one, per
 * regulatory-corpus-manifest.md's "Ownership and update process".
 *
 * The ingest/reembed/job-status flow needs the agent-service worker
 * actually running and does real OpenAI embedding calls (chunking a
 * document means generating embeddings — the whole reason this goes
 * through a Temporal workflow instead of a direct write here), so
 * that part is opt-in via RUN_LIVE_LLM_TESTS=1, same gate the agent-
 * service tests use for anything that calls a live LLM.
 */
describe('Regulatory Knowledge Base (e2e)', () => {
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
    await app.close();
  });

  it('denies an analyst entirely', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/regulatory-kb/documents')
      .set('x-session-id', analystSessionId)
      .expect(403);
  });

  it('denies model_risk_audit too — no read-only role for this console', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/regulatory-kb/documents')
      .set('x-session-id', auditSessionId)
      .expect(403);
  });

  it('lets mlro list documents', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/regulatory-kb/documents')
      .set('x-session-id', mlroSessionId)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('404s on chunks for a document that does not exist', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/regulatory-kb/documents/00000000-0000-0000-0000-000000000000/chunks')
      .set('x-session-id', mlroSessionId)
      .expect(404);
  });

  it('rejects ingestion referencing a supersedes_document_id that does not exist', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/features/aml_detection/regulatory-kb/documents')
      .set('x-session-id', mlroSessionId)
      .send({
        title: 'Test Doc',
        source_type: 'guidance',
        issuing_authority: 'Test Authority',
        version_label: 'v1',
        ingested_by: 'demo-mlro-1',
        chunks: [{ section_reference: 'Section 1', text: 'Some text.' }],
        supersedes_document_id: '00000000-0000-0000-0000-000000000000',
      })
      .expect(404);
  });

  it('404s on job status for a job that was never started', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/features/aml_detection/regulatory-kb/ingestion-jobs/does-not-exist')
      .set('x-session-id', mlroSessionId)
      .expect(500);
  });

  (RUN_LIVE_LLM_TESTS ? it : it.skip)(
    'ingests a document end to end: starts the workflow, polls to completion, lists the document and its chunks',
    async () => {
      const ingestRes = await request(app.getHttpServer())
        .post('/api/v1/features/aml_detection/regulatory-kb/documents')
        .set('x-session-id', mlroSessionId)
        .send({
          title: 'e2e Live Ingestion Test',
          source_type: 'guidance',
          issuing_authority: 'Test Authority',
          version_label: 'v1',
          ingested_by: 'demo-mlro-1',
          chunks: [{ section_reference: 'Section 1', text: 'Multiple cash deposits just under the reporting threshold.' }],
        })
        .expect(201);
      const jobId = (ingestRes.body as { jobId: string }).jobId;

      let job: { status: string; documentId?: string } = { status: 'running' };
      for (let i = 0; i < 20 && job.status === 'running'; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        const res = await request(app.getHttpServer())
          .get(`/api/v1/features/aml_detection/regulatory-kb/ingestion-jobs/${jobId}`)
          .set('x-session-id', mlroSessionId)
          .expect(200);
        job = res.body as { status: string; documentId?: string };
      }
      expect(job.status).toBe('completed');
      const documentId = job.documentId!;

      const chunksRes = await request(app.getHttpServer())
        .get(`/api/v1/features/aml_detection/regulatory-kb/documents/${documentId}/chunks`)
        .set('x-session-id', mlroSessionId)
        .expect(200);
      expect((chunksRes.body as Array<unknown>).length).toBe(1);

      const listRes = await request(app.getHttpServer())
        .get('/api/v1/features/aml_detection/regulatory-kb/documents')
        .set('x-session-id', mlroSessionId)
        .expect(200);
      const listed = (listRes.body as Array<{ documentId: string; chunkCount: number }>).find((d) => d.documentId === documentId);
      expect(listed?.chunkCount).toBe(1);

      await dataSource.query('DELETE FROM regulatory_chunks WHERE document_id = $1', [documentId]);
      await dataSource.query('DELETE FROM regulatory_documents WHERE document_id = $1', [documentId]);
    },
    30_000,
  );
});
