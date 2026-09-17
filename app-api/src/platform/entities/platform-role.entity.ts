import { Column, Entity, PrimaryColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::PlatformRole
 * specs/platform/05-rbac-platform-spec.md: featureCode is null for
 * platform-level, cross-feature roles (platform.sys_admin,
 * platform.model_risk_audit, platform.external_examiner) — set only
 * for feature-namespaced roles (aml_detection.analyst_l1 etc.). */
@Entity({ name: 'platform_roles' })
export class PlatformRole {
  @PrimaryColumn({ name: 'role_code' })
  roleCode!: string;

  @Column({ name: 'feature_code', nullable: true })
  featureCode?: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column()
  description!: string;
}
