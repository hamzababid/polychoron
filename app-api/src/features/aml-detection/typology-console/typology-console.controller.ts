import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  TypologyConsoleService,
  type RegressionRunView,
  type TypologyConsoleOverview,
  type TypologyDetail,
  type TypologyHistory,
  type VersionView,
} from './typology-console.service.js';
import { PromoteTypologyDto } from '../dto/promote-typology.dto.js';
import { CreateTypologyDto, DiscardDraftDto, UpdateDraftDto } from '../dto/typology-lifecycle.dto.js';
import { AmlTypologyBacktestJob } from '../entities/aml-typology-backtest-job.entity.js';
import { AmlTypologyPromotion } from '../entities/aml-typology-promotion.entity.js';
import type { PlatformUser } from '../../../platform/entities/index.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../../common/auth/current-user.decorator.js';

const READ_ROLES = ['aml_detection.mlro_compliance_head', 'platform.model_risk_audit'];
const WRITE_ROLES = ['aml_detection.mlro_compliance_head'];

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * RBAC: mlro_compliance_head (full, including promote),
 * model_risk_audit (read-only) — enforced per-route below, not just
 * at the class level, so every write stays exclusive to
 * mlro_compliance_head. The acting user is always the session user. */
@ApiTags('Typology Console')
@Controller('features/aml_detection/typologies')
@UseGuards(SessionGuard, RolesGuard)
export class TypologyConsoleController {
  constructor(private readonly typologyConsoleService: TypologyConsoleService) {}

  @RequireRoles(...READ_ROLES)
  @Get()
  async list(@CurrentUser() user: PlatformUser): Promise<TypologyConsoleOverview> {
    return this.typologyConsoleService.list(user);
  }

  // Static paths before `:code` so they aren't read as a typology code.
  @RequireRoles(...READ_ROLES)
  @Get('backtest-jobs/:jobId')
  async backtestJob(@Param('jobId') jobId: string): Promise<AmlTypologyBacktestJob> {
    return this.typologyConsoleService.getBacktestJob(jobId);
  }

  @RequireRoles(...READ_ROLES)
  @Get('regression-runs/:runId')
  async regressionRun(@Param('runId') runId: string): Promise<RegressionRunView> {
    return this.typologyConsoleService.getRegressionRun(runId);
  }

  @RequireRoles(...READ_ROLES)
  @Get(':code')
  async get(@Param('code') code: string, @CurrentUser() user: PlatformUser): Promise<TypologyDetail> {
    return this.typologyConsoleService.get(code, user);
  }

  @RequireRoles(...READ_ROLES)
  @Get(':code/history')
  async history(@Param('code') code: string): Promise<TypologyHistory> {
    return this.typologyConsoleService.getHistory(code);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post()
  async create(@Body() dto: CreateTypologyDto, @CurrentUser() user: PlatformUser): Promise<TypologyDetail> {
    return this.typologyConsoleService.create(dto, user);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code/draft')
  async openDraft(@Param('code') code: string, @CurrentUser() user: PlatformUser): Promise<VersionView> {
    return this.typologyConsoleService.openDraft(code, user);
  }

  @RequireRoles(...WRITE_ROLES)
  @Patch(':code/draft')
  async updateDraft(
    @Param('code') code: string,
    @Body() dto: UpdateDraftDto,
    @CurrentUser() user: PlatformUser,
  ): Promise<VersionView> {
    return this.typologyConsoleService.updateDraft(code, dto, user);
  }

  @RequireRoles(...WRITE_ROLES)
  @Delete(':code/draft')
  async discardDraft(
    @Param('code') code: string,
    @Body() dto: DiscardDraftDto,
    @CurrentUser() user: PlatformUser,
  ): Promise<VersionView> {
    return this.typologyConsoleService.discardDraft(code, dto.reason, user);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code/draft/regression')
  @HttpCode(202)
  async startRegression(
    @Param('code') code: string,
    @CurrentUser() user: PlatformUser,
  ): Promise<{ runId: string; candidateKey: string }> {
    return this.typologyConsoleService.startRegression(code, user);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code/backtest')
  async backtest(@Param('code') code: string): Promise<AmlTypologyBacktestJob> {
    return this.typologyConsoleService.startBacktest(code);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code/promote')
  async promote(
    @Param('code') code: string,
    @Body() dto: PromoteTypologyDto,
    @CurrentUser() user: PlatformUser,
  ): Promise<AmlTypologyPromotion> {
    return this.typologyConsoleService.promote(code, dto, user);
  }
}
