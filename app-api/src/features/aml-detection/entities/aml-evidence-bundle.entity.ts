import { Column, Entity, PrimaryColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/data-models.py::EvidenceBundle
 * READ-ONLY from app-api — written exclusively by agent-service's
 * Evidence Gathering Agent. Do not add write methods against this
 * entity in app-api. */
@Entity({ name: 'aml_evidence_bundles' })
export class AmlEvidenceBundle {
  @PrimaryColumn({ name: 'case_id' })
  caseId!: string;

  @Column({ type: 'jsonb' })
  kyc!: Record<string, unknown>;

  @Column({ name: 'transaction_timeline', type: 'jsonb' })
  transactionTimeline!: Record<string, unknown>[];

  @Column({ name: 'linked_entities', type: 'jsonb' })
  linkedEntities!: Record<string, unknown>[];

  @Column({ name: 'prior_cases', type: 'jsonb' })
  priorCases!: Record<string, unknown>[];

  @Column({ name: 'screening_results', type: 'jsonb' })
  screeningResults!: Record<string, unknown>[];

  @Column({ name: 'assembled_at', type: 'timestamptz' })
  assembledAt!: Date;

  @Column({ name: 'agent_version' })
  agentVersion!: string;
}
