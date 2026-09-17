import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AmlCase } from './entities/aml-case.entity.js';
import { AmlDisposition } from './entities/aml-disposition.entity.js';
import { AmlStrFiling } from './entities/aml-str-filing.entity.js';
import { AmlFilingEdit } from './entities/aml-filing-edit.entity.js';
import { AmlFmuFollowup } from './entities/aml-fmu-followup.entity.js';
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
      FeatureCaseEnvelope,
      PlatformUser,
      PlatformSession,
    ]),
    TemporalModule,
    CommonAuthModule,
  ],
  controllers: [AmlDetectionController, FilingConsoleController, GoamlTrackerController, DashboardController],
  providers: [AmlDetectionService, AlertQueueService, CaseWorkspaceService, FilingConsoleService, GoamlTrackerService, DashboardService],
})
export class AmlDetectionModule {}
