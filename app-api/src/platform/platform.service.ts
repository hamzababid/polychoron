import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Feature, Suite } from './entities/index.js';

export interface SuiteWithFeatures {
  suiteCode: string;
  suiteName: string;
  description: string;
  features: Feature[];
}

@Injectable()
export class PlatformService {
  constructor(
    @InjectRepository(Suite) private readonly suites: Repository<Suite>,
    @InjectRepository(Feature) private readonly features: Repository<Feature>,
  ) {}

  async listSuitesWithFeatures(): Promise<SuiteWithFeatures[]> {
    const [suites, features] = await Promise.all([this.suites.find(), this.features.find()]);

    return suites.map((suite) => ({
      suiteCode: suite.suiteCode,
      suiteName: suite.suiteName,
      description: suite.description,
      features: features.filter((f) => f.suiteCode === suite.suiteCode),
    }));
  }
}
