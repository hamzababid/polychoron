import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { PlatformSession, PlatformUser } from '../src/platform/entities/index.js';

describe('Demo auth (e2e)', () => {
  let app: INestApplication<App>;
  let userRepo: Repository<PlatformUser>;
  let sessionRepo: Repository<PlatformSession>;

  const userId = `test-user-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    userRepo = moduleFixture.get(getRepositoryToken(PlatformUser));
    sessionRepo = moduleFixture.get(getRepositoryToken(PlatformSession));

    // Reuses the demo tenant seeded by agent-service's
    // seed_platform_registry.py, since platform_users.tenant_id is a
    // foreign key to tenants.
    await userRepo.save({
      userId,
      tenantId: 'demo-northbridge-bank',
      displayName: 'E2E Test User',
      email: 'e2e-test-user@example.test',
      roleCodes: ['aml_detection.analyst_l1'],
    });
  });

  afterAll(async () => {
    await sessionRepo.delete({ userId });
    await userRepo.delete({ userId });
    await app.close();
  });

  it('logs in a known demo user and returns a session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ user_id: userId })
      .expect(201);

    const body = res.body as { sessionId: string; user: { userId: string; roleCodes: string[] } };
    expect(body.sessionId).toBeTruthy();
    expect(body.user.userId).toBe(userId);
    expect(body.user.roleCodes).toEqual(['aml_detection.analyst_l1']);

    const savedSession = await sessionRepo.findOneBy({ sessionId: body.sessionId });
    expect(savedSession).not.toBeNull();
    expect(savedSession?.userId).toBe(userId);
  });

  it('rejects an unknown user_id with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/demo-login')
      .send({ user_id: 'no-such-demo-user' })
      .expect(401);
  });

  it('rejects a request missing user_id with 400', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/demo-login').send({}).expect(400);
  });
});
