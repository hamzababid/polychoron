import { Column, Entity, PrimaryColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::PlatformUser */
@Entity({ name: 'platform_users' })
export class PlatformUser {
  @PrimaryColumn({ name: 'user_id' })
  userId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'display_name' })
  displayName!: string;

  @Column()
  email!: string;

  @Column({ name: 'role_codes', type: 'text', array: true, default: '{}' })
  roleCodes!: string[];
}
