import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ModelGovernanceService,
  type ConsistencyResponse,
  type DataLineageResponse,
  type EvalRunsResponse,
  type FairnessFlagsResponse,
  type GuardrailViolationsResponse,
  type ModelVersionsResponse,
  type SamplingOverview,
  type SamplingReviewRow,
} from './model-governance.service.js';
import { RecordSamplingReviewDto } from '../dto/record-sampling-review.dto.js';
import { SamplingQueryDto } from '../dto/sampling-query.dto.js';
import { PageQueryDto } from '../dto/page-query.dto.js';
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
@ApiTags('Model Governance')
@Controller('features/aml_detection/governance')
@UseGuards(SessionGuard, RolesGuard)
export class ModelGovernanceController {
  constructor(private readonly modelGovernanceService: ModelGovernanceService) {}

  @RequireRoles(...SAMPLING_READ_ROLES)
  @Get('sampling')
  async getSampling(@Query() query: SamplingQueryDto): Promise<SamplingOverview> {
    return this.modelGovernanceService.getSamplingOverview({
      pendingPage: query.pending_page ?? 1,
      pendingPageSize: query.pending_page_size ?? 10,
      reviewedPage: query.reviewed_page ?? 1,
      reviewedPageSize: query.reviewed_page_size ?? 10,
    });
  }

  @RequireRoles(...WRITE_ROLES)
  @Post('sampling/:caseId/review')
  async reviewSampling(@Param('caseId') caseId: string, @Body() dto: RecordSamplingReviewDto): Promise<SamplingReviewRow> {
    return this.modelGovernanceService.recordReview(caseId, dto);
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('consistency')
  async getConsistency(@Query() query: PageQueryDto): Promise<ConsistencyResponse> {
    return this.modelGovernanceService.getConsistency(query.page ?? 1, query.page_size ?? 10);
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('model-versions')
  async getModelVersions(@Query() query: PageQueryDto): Promise<ModelVersionsResponse> {
    return this.modelGovernanceService.getModelVersions(query.page ?? 1, query.page_size ?? 10);
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('data-lineage')
  async getDataLineage(): Promise<DataLineageResponse> {
    return this.modelGovernanceService.getDataLineage();
  }

  // ADDITIVE (specs/platform/11-evals-and-guardrails-framework.md) —
  // eval E1 (golden-dataset regression) and E5 (fairness monitoring),
  // both read-only: agent-service is the writer.

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('eval-runs')
  async getEvalRuns(@Query() query: PageQueryDto): Promise<EvalRunsResponse> {
    return this.modelGovernanceService.getEvalRuns(query.page ?? 1, query.page_size ?? 10);
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('fairness-flags')
  async getFairnessFlags(@Query() query: PageQueryDto): Promise<FairnessFlagsResponse> {
    return this.modelGovernanceService.getFairnessFlags(query.page ?? 1, query.page_size ?? 10);
  }

  @RequireRoles(...CONSISTENCY_AUDIT_ROLES)
  @Get('guardrail-violations')
  async getGuardrailViolations(@Query() query: PageQueryDto): Promise<GuardrailViolationsResponse> {
    return this.modelGovernanceService.getGuardrailViolations(query.page ?? 1, query.page_size ?? 10);
  }
}
