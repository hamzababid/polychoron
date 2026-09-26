import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Feature,
  FeatureCaseEnvelope,
  PlatformAgentActivityLog,
  PlatformEvalRun,
  PlatformFairnessMonitoringSnapshot,
  PlatformGuardrailViolation,
  PlatformKillSwitchScope,
  PlatformRole,
  PlatformSession,
  PlatformUser,
  RegulatoryChunk,
  RegulatoryChunkingProfile,
  RegulatoryDocument,
  RegulatoryDocumentChange,
  RegulatorySourceFile,
  Suite,
  Tenant,
} from '../../platform/entities/index.js';
import { AmlCase } from '../../features/aml-detection/entities/aml-case.entity.js';
import { AmlDisposition } from '../../features/aml-detection/entities/aml-disposition.entity.js';
import { AmlStrFiling } from '../../features/aml-detection/entities/aml-str-filing.entity.js';
import { AmlEvidenceBundle } from '../../features/aml-detection/entities/aml-evidence-bundle.entity.js';
import { AmlTypologyMatch } from '../../features/aml-detection/entities/aml-typology-match.entity.js';
import { AmlCaseAssessment } from '../../features/aml-detection/entities/aml-case-assessment.entity.js';
import { AmlFilingEdit } from '../../features/aml-detection/entities/aml-filing-edit.entity.js';
import { AmlFmuFollowup } from '../../features/aml-detection/entities/aml-fmu-followup.entity.js';
import { AmlTypologyConfig } from '../../features/aml-detection/entities/aml-typology-config.entity.js';
import { AmlTypologyConfigVersion } from '../../features/aml-detection/entities/aml-typology-config-version.entity.js';
import { AmlTypologyBacktestJob } from '../../features/aml-detection/entities/aml-typology-backtest-job.entity.js';
import { AmlTypologyPromotion } from '../../features/aml-detection/entities/aml-typology-promotion.entity.js';
import { AmlSamplingReview } from '../../features/aml-detection/entities/aml-sampling-review.entity.js';
import { AmlReportGeneration } from '../../features/aml-detection/entities/aml-report-generation.entity.js';

/**
 * Schema is owned by infra/db/migrations/*.sql, never by TypeORM
 * (synchronize is always false) — see
 * specs/platform/09-backend-service-boundary-spec.md. TypeORM here is
 * strictly a typed mapping onto a schema that already exists.
 *
 * Every entity must be listed in the `entities` array below *and* in
 * whichever feature module's TypeOrmModule.forFeature([...]) uses it
 * — these are two separate registrations; forgetting this one throws
 * a runtime EntityMetadataNotFoundError, not a build-time error.
 */
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('DATABASE_HOST', 'localhost'),
        port: config.get<number>('DATABASE_PORT', 5432),
        username: config.get<string>('DATABASE_USER', 'polychoron'),
        password: config.get<string>('DATABASE_PASSWORD', 'polychoron_dev_only'),
        database: config.get<string>('DATABASE_NAME', 'polychoron'),
        synchronize: false,
        entities: [
          Suite,
          Feature,
          Tenant,
          FeatureCaseEnvelope,
          PlatformRole,
          PlatformUser,
          PlatformSession,
          PlatformAgentActivityLog,
          PlatformKillSwitchScope,
          PlatformGuardrailViolation,
          PlatformEvalRun,
          PlatformFairnessMonitoringSnapshot,
          RegulatoryDocument,
          RegulatoryChunk,
          RegulatorySourceFile,
          RegulatoryDocumentChange,
          RegulatoryChunkingProfile,
          AmlCase,
          AmlDisposition,
          AmlStrFiling,
          AmlEvidenceBundle,
          AmlTypologyMatch,
          AmlCaseAssessment,
          AmlFilingEdit,
          AmlFmuFollowup,
          AmlTypologyConfig,
          AmlTypologyConfigVersion,
          AmlTypologyBacktestJob,
          AmlTypologyPromotion,
          AmlSamplingReview,
          AmlReportGeneration,
        ],
      }),
    }),
  ],
})
export class DatabaseModule {}
