import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ModelGovernanceService,
  type ConsistencyResponse,
  type DataLineageResponse,
  type ModelVersionsResponse,
  type SamplingOverview,
  type SamplingReviewRow,
} from './model-governance.service.js';
import { RecordSamplingReviewDto } from '../dto/record-sampling-review.dto.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

const MLRO = 'aml_detection.mlro_compliance_head';
const MODEL_RISK_AUDIT = 'platform.model_risk_audit';
const EXTERNAL_EXAMINER = 'platform.external_examiner';

// TASKS.md: "RBAC: aml_detection.mlro_compliance_head full;
// platform.model_risk_audit read-only; platform.external_examiner
// read-only, sampling data only" — external_examiner is deliberately
// left off CONSISTENCY_AUDIT_ROLES: consistency/model-versions/
// data-lineage are not "sampling data", per the screen's acceptance
// criterion that examiner access never sees more than SamplingReview
// itself carries.
const SAMPLING_READ_ROLES = [MLRO, MODEL_RISK_AUDIT, EXTERNAL_EXAMINER];
const CONSISTENCY_AUDIT_ROLES = [MLRO, MODEL_RISK_AUDIT];
const WRITE_ROLES = [MLRO];

/** specs/suites/bfsi/features/aml-detection/screens/09-model-governance-audit.md */
@Controller('features/aml_detection/governance')
@UseGuards(SessionGuard, RolesGuard)
export class ModelGovernanceController {
  constructor(private readonly modelGovernanceService: ModelGovernanceService) {}

  @RequireRoles(...SAMPLING_READ_ROLES)
  @Get('sampling')
  async getSampling(): Promise<SamplingOverview> {
    return this.modelGovernanceService.getSamplingOverview();
  }

  @RequireRoles(...WRITE_ROLES)
  @Post('sampling/:caseId/review')
  async reviewSampling(@Param('caseId') caseId: string, @Body() dto: RecordSamplingReviewDto): Promise<SamplingReviewRow> {
    return this.modelGovernanceService.recordReview(caseId, dto);
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('consistency')
  async getConsistency(): Promise<ConsistencyResponse> {
    return this.modelGovernanceService.getConsistency();
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('model-versions')
  async getModelVersions(): Promise<ModelVersionsResponse> {
    return this.modelGovernanceService.getModelVersions();
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('data-lineage')
  async getDataLineage(): Promise<DataLineageResponse> {
    return this.modelGovernanceService.getDataLineage();
  }
}
