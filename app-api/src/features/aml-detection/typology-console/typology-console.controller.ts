import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { TypologyConsoleService, type TypologyRow } from './typology-console.service.js';
import { UpdateTypologyDto } from '../dto/update-typology.dto.js';
import { PromoteTypologyDto } from '../dto/promote-typology.dto.js';
import { AmlTypologyConfig } from '../entities/aml-typology-config.entity.js';
import { AmlTypologyConfigVersion } from '../entities/aml-typology-config-version.entity.js';
import { AmlTypologyBacktestJob } from '../entities/aml-typology-backtest-job.entity.js';
import { AmlTypologyPromotion } from '../entities/aml-typology-promotion.entity.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

const READ_ROLES = ['aml_detection.mlro_compliance_head', 'platform.model_risk_audit'];
const WRITE_ROLES = ['aml_detection.mlro_compliance_head'];

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * RBAC: mlro_compliance_head (full, including promote),
 * model_risk_audit (read-only) — enforced per-route below, not just
 * at the class level, so promote stays exclusive to mlro_compliance_head. */
@Controller('features/aml_detection/typologies')
@UseGuards(SessionGuard, RolesGuard)
export class TypologyConsoleController {
  constructor(private readonly typologyConsoleService: TypologyConsoleService) {}

  @RequireRoles(...READ_ROLES)
  @Get()
  async list(): Promise<TypologyRow[]> {
    return this.typologyConsoleService.list();
  }

  @RequireRoles(...READ_ROLES)
  @Get(':code/history')
  async history(@Param('code') code: string): Promise<AmlTypologyConfigVersion[]> {
    return this.typologyConsoleService.getHistory(code);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code')
  async update(@Param('code') code: string, @Body() dto: UpdateTypologyDto): Promise<AmlTypologyConfig> {
    return this.typologyConsoleService.update(code, dto);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code/backtest')
  async backtest(@Param('code') code: string): Promise<AmlTypologyBacktestJob> {
    return this.typologyConsoleService.startBacktest(code);
  }

  @RequireRoles(...READ_ROLES)
  @Get('backtest-jobs/:jobId')
  async backtestJob(@Param('jobId') jobId: string): Promise<AmlTypologyBacktestJob> {
    return this.typologyConsoleService.getBacktestJob(jobId);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':code/promote')
  async promote(@Param('code') code: string, @Body() dto: PromoteTypologyDto): Promise<AmlTypologyPromotion> {
    return this.typologyConsoleService.promote(code, dto);
  }
}
