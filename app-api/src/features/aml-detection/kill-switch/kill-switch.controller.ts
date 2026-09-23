import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KillSwitchService } from './kill-switch.service.js';
import { DisableKillSwitchDto } from '../dto/disable-kill-switch.dto.js';
import { ReactivateKillSwitchDto } from '../dto/reactivate-kill-switch.dto.js';
import { PlatformKillSwitchScope } from '../../../platform/entities/index.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

const READ_ROLES = ['aml_detection.mlro_compliance_head', 'platform.model_risk_audit'];
const WRITE_ROLES = ['aml_detection.mlro_compliance_head'];

/** specs/platform/11-evals-and-guardrails-framework.md, guardrail G6.
 * TASKS.md: "Build the kill-switch control itself
 * (mlro_compliance_head-only action) — minimal UI is fine for now, but
 * the enforcement must be real, not a stub." Enforcement is real: see
 * agent-service/app/platform/guardrails/repository.py's
 * is_feature_active()/is_typology_active(), read by
 * graph.py/typology_config_repository.py before any typology-specific
 * reasoning runs. */
@ApiTags('Kill Switch')
@Controller('features/aml_detection/kill-switch')
@UseGuards(SessionGuard, RolesGuard)
export class KillSwitchController {
  constructor(private readonly killSwitchService: KillSwitchService) {}

  @RequireRoles(...READ_ROLES)
  @Get()
  async listActive(): Promise<PlatformKillSwitchScope[]> {
    return this.killSwitchService.listActive();
  }

  @RequireRoles(...WRITE_ROLES)
  @Post()
  async disable(@Body() dto: DisableKillSwitchDto): Promise<PlatformKillSwitchScope> {
    return this.killSwitchService.disable(dto);
  }

  @RequireRoles(...WRITE_ROLES)
  @Post(':scopeId/reactivate')
  async reactivate(@Param('scopeId') scopeId: string, @Body() dto: ReactivateKillSwitchDto): Promise<PlatformKillSwitchScope> {
    return this.killSwitchService.reactivate(scopeId, dto.reactivated_by);
  }
}
