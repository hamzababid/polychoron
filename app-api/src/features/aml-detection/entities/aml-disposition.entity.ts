import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

export enum DispositionType {
  CLEAR = 'clear',
  ENHANCED_MONITORING = 'enhanced_monitoring',
  ESCALATE_SENIOR = 'escalate_senior',
  FILE_STR = 'file_str',
  FILE_CTR = 'file_ctr',
}

/** specs/suites/bfsi/features/aml-detection/data-models.py::Disposition
 * Always human-authored. Owned (writes) by app-api. The
 * override_reason-required rule (constitution rule 4) is also enforced
 * at the database layer (see aml_dispositions_override_reason_required
 * CHECK constraint) — do not rely on application code alone. */
@Entity({ name: 'aml_dispositions' })
export class AmlDisposition {
  @PrimaryColumn({ name: 'case_id' })
  caseId!: string;

  @Column({ name: 'officer_id' })
  officerId!: string;

  @Column({ name: 'disposition_type', type: 'text' })
  dispositionType!: DispositionType;

  @Column({ name: 'officer_notes' })
  officerNotes!: string;

  @Column({ name: 'overrides_agent_recommendation', default: false })
  overridesAgentRecommendation!: boolean;

  @Column({ name: 'override_reason', nullable: true })
  overrideReason?: string;

  @CreateDateColumn({ name: 'decided_at' })
  decidedAt!: Date;
}
