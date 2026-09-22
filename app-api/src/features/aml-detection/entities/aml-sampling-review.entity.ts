import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/data-models.py::SamplingReview
 * Deferred from Phase 1's 003_aml_detection_core.sql — added in
 * 010_aml_sampling_review.sql for Model Governance & Audit
 * (screens/09-model-governance-audit.md). Owned (writes) by app-api —
 * a sampling review is a human compliance action, not agent output. */
@Entity({ name: 'aml_sampling_reviews' })
export class AmlSamplingReview {
  @PrimaryGeneratedColumn('uuid', { name: 'review_id' })
  reviewId!: string;

  @Column({ name: 'case_id' })
  caseId!: string;

  @Column({ name: 'original_disposition' })
  originalDisposition!: string;

  @Column({ name: 'reviewer_id' })
  reviewerId!: string;

  @Column({ name: 'reviewer_agreed' })
  reviewerAgreed!: boolean;

  @Column({ name: 'reviewer_notes', type: 'text', nullable: true })
  reviewerNotes?: string;

  @CreateDateColumn({ name: 'reviewed_at' })
  reviewedAt!: Date;
}
