import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum ReportType {
  STR_F = 'str_f',
  CTR = 'ctr',
  CTR_A = 'ctr_a',
  STR_A = 'str_a',
}

export enum FilingSubmissionStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  ACKNOWLEDGED = 'acknowledged',
  FEEDBACK_RECEIVED = 'feedback_received',
}

/** specs/suites/bfsi/features/aml-detection/data-models.py::STRFiling
 * Owned (writes) by app-api — the Filing Console's endpoints. */
@Entity({ name: 'aml_str_filings' })
export class AmlStrFiling {
  @PrimaryGeneratedColumn('uuid', { name: 'filing_id' })
  filingId!: string;

  @Column({ name: 'case_id' })
  caseId!: string;

  @Column({ name: 'report_type', type: 'text' })
  reportType!: ReportType;

  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  @Column({ name: 'final_narrative' })
  finalNarrative!: string;

  @Column({ type: 'jsonb' })
  attestation!: Record<string, unknown>;

  @Column({ name: 'submission_status', type: 'text', default: FilingSubmissionStatus.DRAFT })
  submissionStatus!: FilingSubmissionStatus;

  @Column({ name: 'goaml_reference', nullable: true })
  goamlReference?: string;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt?: Date;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt?: Date;

  @Column({ name: 'retention_expiry', type: 'timestamptz', nullable: true })
  retentionExpiry?: Date;
}
