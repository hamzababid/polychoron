import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { PlatformKillSwitchScope } from '../../../platform/entities/index.js';

const FEATURE_CODE = 'aml_detection';
// Phase 1 has exactly one demo tenant — see
// specs/platform/02-platform-data-models.py::Tenant and mvp-phases.md.
const DEMO_TENANT_ID = 'demo-northbridge-bank';

/** specs/platform/11-evals-and-guardrails-framework.md, guardrail G6.
 * Writes (create/reactivate) live here — agent-service only reads
 * platform_kill_switch_scopes (app/platform/guardrails/repository.py),
 * same read/write split as the Typology Console's aml_typology_configs. */
@Injectable()
export class KillSwitchService {
  constructor(@InjectRepository(PlatformKillSwitchScope) private readonly scopes: Repository<PlatformKillSwitchScope>) {}

  async listActive(): Promise<PlatformKillSwitchScope[]> {
    return this.scopes.find({
      where: { tenantId: DEMO_TENANT_ID, featureCode: FEATURE_CODE, reactivatedAt: IsNull() },
      order: { disabledAt: 'DESC' },
    });
  }

  async disable(dto: { typology_code?: string; reason: string; disabled_by: string }): Promise<PlatformKillSwitchScope> {
    const existing = await this.scopes.findOne({
      where: {
        tenantId: DEMO_TENANT_ID,
        featureCode: FEATURE_CODE,
        typologyCode: dto.typology_code ?? IsNull(),
        reactivatedAt: IsNull(),
      },
    });
    if (existing) {
      const scopeLabel = dto.typology_code ?? 'the entire feature';
      throw new BadRequestException(`${scopeLabel} already has an active kill switch (scope_id=${existing.scopeId})`);
    }

    return this.scopes.save({
      tenantId: DEMO_TENANT_ID,
      featureCode: FEATURE_CODE,
      typologyCode: dto.typology_code ?? null,
      disabledBy: dto.disabled_by,
      disabledAt: new Date(),
      reason: dto.reason,
    });
  }

  async reactivate(scopeId: string, reactivatedBy: string): Promise<PlatformKillSwitchScope> {
    const scope = await this.scopes.findOneBy({ scopeId });
    if (!scope) {
      throw new NotFoundException(`No kill switch scope with scope_id=${scopeId}`);
    }
    if (scope.reactivatedAt) {
      throw new BadRequestException(`scope_id=${scopeId} was already reactivated`);
    }

    await this.scopes.update({ scopeId }, { reactivatedAt: new Date(), reactivatedBy });
    return (await this.scopes.findOneBy({ scopeId }))!;
  }
}
