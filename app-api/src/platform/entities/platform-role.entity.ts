import { Column, Entity, PrimaryColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::PlatformRole */
@Entity({ name: 'platform_roles' })
export class PlatformRole {
  @PrimaryColumn({ name: 'role_code' })
  roleCode!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column()
  description!: string;
}
