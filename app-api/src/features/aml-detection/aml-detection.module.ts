import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmlCase } from './entities/aml-case.entity.js';
import { AmlDisposition } from './entities/aml-disposition.entity.js';
import { AmlStrFiling } from './entities/aml-str-filing.entity.js';
import { AmlFilingEdit } from './entities/aml-filing-edit.entity.js';
import { AmlFmuFollowup } from './entities/aml-fmu-followup.entity.js';
import { AmlTypologyConfig } from './entities/aml-typology-config.entity.js';
import { AmlTypologyConfigVersion } from './entities/aml-typology-config-version.entity.js';
import { AmlTypologyBacktestJob } from './entities/aml-typology-backtest-job.entity.js';
import { AmlTypologyPromotion } from './entities/aml-typology-promotion.entity.js';
import { AmlSamplingReview } from './entities/aml-sampling-review.entity.js';
import { FeatureCaseEnvelope, PlatformSession, PlatformUser } from '../../platform/entities/index.js';
import { AmlDetectionController } from './aml-detection.controller.js';
import { AmlDetectionService } from './aml-detection.service.js';
import { AlertQueueService } from './alert-queue/alert-queue.service.js';
import { CaseWorkspaceService } from './case-workspace/case-workspace.service.js';
import { FilingConsoleController } from './filing-console/filing-console.controller.js';
import { FilingConsoleService } from './filing-console/filing-console.service.js';
import { GoamlTrackerController } from './goaml-tracker/goaml-tracker.controller.js';
import { GoamlTrackerService } from './goaml-tracker/goaml-tracker.service.js';
import { DashboardController } from './dashboard/dashboard.controller.js';
import { DashboardService } from './dashboard/dashboard.service.js';
import { TypologyConsoleController } from './typology-console/typology-console.controller.js';
import { TypologyConsoleService } from './typology-console/typology-console.service.js';
import { Customer360Controller } from './customer-360/customer-360.controller.js';
import { Customer360Service } from './customer-360/customer-360.service.js';
import { ModelGovernanceController } from './model-governance/model-governance.controller.js';
import { ModelGovernanceService } from './model-governance/model-governance.service.js';
import { TemporalModule } from '../../common/temporal/temporal.module.js';
import { CommonAuthModule } from '../../common/auth/common-auth.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AmlCase,
      AmlDisposition,
      AmlStrFiling,
      AmlFilingEdit,
      AmlFmuFollowup,
      AmlTypologyConfig,
      AmlTypologyConfigVersion,
      AmlTypologyBacktestJob,
      AmlTypologyPromotion,
      AmlSamplingReview,
      FeatureCaseEnvelope,
      PlatformUser,
      PlatformSession,
    ]),
    TemporalModule,
    CommonAuthModule,
  ],
  controllers: [
    AmlDetectionController,
    FilingConsoleController,
    GoamlTrackerController,
    DashboardController,
    TypologyConsoleController,
    Customer360Controller,
    ModelGovernanceController,
  ],
  providers: [
    AmlDetectionService,
    AlertQueueService,
    CaseWorkspaceService,
    FilingConsoleService,
    GoamlTrackerService,
    DashboardService,
    TypologyConsoleService,
    Customer360Service,
    ModelGovernanceService,
  ],
})
export class AmlDetectionModule {}
