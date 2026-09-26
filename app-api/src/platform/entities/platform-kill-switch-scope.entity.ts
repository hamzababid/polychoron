import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::KillSwitchScope
 * specs/platform/11-evals-and-guardrails-framework.md, guardrail G6.
 *
 * Written (created/reactivated) by app-api's kill-switch endpoint
 * (mlro_compliance_head-only, see
 * features/aml-detection/kill-switch/kill-switch.controller.ts) —
 * agent-service only reads it, same read/write split as
 * aml_typology_configs. typologyCode null means the entire feature is
 * disabled for that tenant. */
@Entity({ name: 'platform_kill_switch_scopes' })
export class PlatformKillSwitchScope {
  @PrimaryGeneratedColumn('uuid', { name: 'scope_id' })
  scopeId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'typology_code', type: 'text', nullable: true })
  typologyCode?: string | null;

  @Column({ name: 'disabled_by' })
  disabledBy!: string;

  @Column({ name: 'disabled_at', type: 'timestamptz' })
  disabledAt!: Date;

  @Column()
  reason!: string;

  @Column({ name: 'reactivated_at', type: 'timestamptz', nullable: true })
  reactivatedAt?: Date | null;

  @Column({ name: 'reactivated_by', type: 'text', nullable: true })
  reactivatedBy?: string | null;
}
