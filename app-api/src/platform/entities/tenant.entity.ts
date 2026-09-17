import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::Tenant */
@Entity({ name: 'tenants' })
export class Tenant {
  @PrimaryColumn({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'tenant_name' })
  tenantName!: string;

  @Column({ name: 'enabled_suites', type: 'text', array: true, default: '{}' })
  enabledSuites!: string[];

  @Column({ name: 'enabled_features', type: 'text', array: true, default: '{}' })
  enabledFeatures!: string[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
