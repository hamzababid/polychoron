import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { Feature, FeatureStatus, Suite } from '../src/platform/entities/index.js';

describe('PlatformController (e2e)', () => {
  let app: INestApplication<App>;
  let suiteRepo: Repository<Suite>;
  let featureRepo: Repository<Feature>;

  const suiteCode = `test-suite-${Date.now()}`;
  const featureCode = `test-feature-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    suiteRepo = moduleFixture.get(getRepositoryToken(Suite));
    featureRepo = moduleFixture.get(getRepositoryToken(Feature));

    await suiteRepo.save({ suiteCode, suiteName: 'Test Suite', description: 'e2e fixture' });
    await featureRepo.save({
      featureCode,
      featureName: 'Test Feature',
      suiteCode,
      description: 'e2e fixture',
      status: FeatureStatus.BETA,
      roleManifestRef: 'n/a',
    });
  });

  afterAll(async () => {
    await featureRepo.delete({ featureCode });
    await suiteRepo.delete({ suiteCode });
    await app.close();
  });

  it('GET /api/v1/platform/suites includes the seeded suite with its nested feature', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/platform/suites').expect(200);

    const found = (res.body as Array<{ suiteCode: string; features: Array<{ featureCode: string }> }>).find(
      (s) => s.suiteCode === suiteCode,
    );
    expect(found).toBeDefined();
    expect(found?.features.map((f) => f.featureCode)).toContain(featureCode);
  });
});
