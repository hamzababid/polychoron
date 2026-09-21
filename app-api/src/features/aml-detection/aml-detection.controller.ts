import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AmlDetectionService, type IngestResult } from './aml-detection.service.js';
import { InboundAlertDto } from './dto/inbound-alert.dto.js';
import { DispositionDto } from './dto/disposition.dto.js';
import { ListAlertsQueryDto } from './dto/list-alerts-query.dto.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { CaseStatus } from './entities/aml-case.entity.js';
import { AlertQueueService, type AlertQueueRow } from './alert-queue/alert-queue.service.js';
import { CaseWorkspaceService, type ActivityLogEntry, type CaseDetail } from './case-workspace/case-workspace.service.js';
import { SessionGuard } from '../../common/auth/session.guard.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { PlatformUser } from '../../platform/entities/index.js';

/** specs/suites/bfsi/features/aml-detection/phase-1-aml-core/api-contracts-phase1.md
 * Namespaced under /features/aml_detection per
 * specs/platform/01-platform-architecture.md, so a future second
 * feature's ingestion endpoint doesn't collide. */
@Controller('features/aml_detection')
export class AmlDetectionController {
  constructor(
    private readonly amlDetectionService: AmlDetectionService,
    private readonly alertQueueService: AlertQueueService,
    private readonly caseWorkspaceService: CaseWorkspaceService,
  ) {}

  @Post('alerts/ingest')
  async ingest(@Body() dto: InboundAlertDto): Promise<IngestResult> {
    return this.amlDetectionService.ingestAlert(dto);
  }

  // --- Alert Queue (screens/02-alert-queue.md) ---

  @UseGuards(SessionGuard)
  @Get('alerts')
  async listAlerts(@Query() query: ListAlertsQueryDto): Promise<{ items: AlertQueueRow[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 20;
    const { items, total } = await this.alertQueueService.list({
      status: query.status,
      riskTier: query.risk_tier,
      page,
      pageSize,
    });
    return { items, total, page, pageSize };
  }

  @UseGuards(SessionGuard)
  @Post('alerts/:caseId/claim')
  async claimAlert(
    @Param('caseId') caseId: string,
    @CurrentUser() user: PlatformUser,
  ): Promise<{ caseId: string; assignedAnalystId: string }> {
    return this.alertQueueService.claim(caseId, user);
  }

  // --- Global search (frontend shell's persistent header) ---

  @UseGuards(SessionGuard)
  @Get('search')
  async search(@Query() query: SearchQueryDto): Promise<AlertQueueRow[]> {
    return this.alertQueueService.search(query.q);
  }

  // --- Case Workspace (screens/03-case-workspace.md) ---

  @UseGuards(SessionGuard)
  @Get('cases/:caseId')
  async getCase(@Param('caseId') caseId: string): Promise<CaseDetail> {
    return this.caseWorkspaceService.getCaseDetail(caseId);
  }

  @UseGuards(SessionGuard)
  @Get('cases/:caseId/activity-log')
  async getCaseActivityLog(@Param('caseId') caseId: string): Promise<ActivityLogEntry[]> {
    return this.caseWorkspaceService.getActivityLog(caseId);
  }

  @UseGuards(SessionGuard)
  @Post('cases/:caseId/disposition')
  async disposition(
    @Param('caseId') caseId: string,
    @Body() dto: DispositionDto,
    @CurrentUser() user: PlatformUser,
  ): Promise<{ caseId: string; status: CaseStatus }> {
    return this.amlDetectionService.recordDisposition(caseId, dto, user);
  }
}
