import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::FeatureCaseEnvelope
 * Written by whichever service creates the feature's case — for
 * Phase 1 AML Detection, that's app-api's alert-ingestion endpoint. */
@Entity({ name: 'feature_case_envelopes' })
export class FeatureCaseEnvelope {
  @PrimaryGeneratedColumn('uuid', { name: 'envelope_id' })
  envelopeId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'suite_code' })
  suiteCode!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'external_case_ref' })
  externalCaseRef!: string;

  @Column()
  status!: string;

  @Column({ name: 'risk_tier', nullable: true })
  riskTier?: string;

  @Column({ name: 'summary_title' })
  summaryTitle!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
