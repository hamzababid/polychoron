import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum CaseStatus {
  OPEN = 'open',
  CLAIMED = 'claimed',
  INVESTIGATING = 'investigating',
  CLEARED = 'cleared',
  ESCALATED = 'escalated',
  PENDING_FILING = 'pending_filing',
  FILED = 'filed',
}

/** specs/suites/bfsi/features/aml-detection/data-models.py::Case
 * (alert field only — evidence/typology_match/assessment/disposition/
 * filing are separate tables/entities joined by case_id).
 * Owned (writes) by app-api: status, assigned_analyst_id. */
@Entity({ name: 'aml_cases' })
export class AmlCase {
  @PrimaryGeneratedColumn('uuid', { name: 'case_id' })
  caseId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ type: 'jsonb' })
  alert!: Record<string, unknown>;

  @Column({ type: 'text', default: CaseStatus.OPEN })
  status!: CaseStatus;

  @Column({ name: 'assigned_analyst_id', nullable: true })
  assignedAnalystId?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt?: Date;
}
