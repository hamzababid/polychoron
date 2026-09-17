import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { GoamlTrackerService, type FilingDetail, type FilingSummary } from './goaml-tracker.service.js';
import { AddFollowupDto } from '../dto/add-followup.dto.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

class ListFilingsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}

/** specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md
 * "This screen and every API it calls is unreachable by any role
 * outside senior_officer_l2/mlro_compliance_head — confidential by
 * nature." Enforced identically to Filing Console. */
@Controller('features/aml_detection/filings')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head')
export class GoamlTrackerController {
  constructor(private readonly goamlTrackerService: GoamlTrackerService) {}

  @Get()
  async list(@Query() query: ListFilingsQueryDto): Promise<{ items: FilingSummary[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const { items, total } = await this.goamlTrackerService.list(page, pageSize);
    return { items, total, page, pageSize };
  }

  @Get(':filingId')
  async getDetail(@Param('filingId') filingId: string): Promise<FilingDetail> {
    return this.goamlTrackerService.getDetail(filingId);
  }

  /** Demo-only — api-contracts-phase1.md: "manually advances status for
   * the live demo, does not exist in Phase 3." */
  @Post(':filingId/simulate-acknowledgment')
  async simulateAcknowledgment(@Param('filingId') filingId: string): Promise<FilingSummary> {
    return this.goamlTrackerService.simulateAcknowledgment(filingId);
  }

  @Post(':filingId/followups')
  async addFollowup(@Param('filingId') filingId: string, @Body() dto: AddFollowupDto): Promise<{ followupId: string }> {
    return this.goamlTrackerService.addFollowup(filingId, dto.note, dto.created_by);
  }
}
