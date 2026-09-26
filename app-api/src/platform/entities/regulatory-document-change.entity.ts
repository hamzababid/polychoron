import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only metadata-correction log for regulatory documents
 * (specs/platform/10-regulatory-knowledge-base-spec.md, "Phase 2
 * addendum"). READ-ONLY from app-api — agent-service writes it inside
 * the same transaction as the correction itself. */
@Entity({ name: 'regulatory_document_changes' })
export class RegulatoryDocumentChange {
  @PrimaryGeneratedColumn('uuid', { name: 'change_id' })
  changeId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'field_name' })
  fieldName!: string;

  @Column({ name: 'old_value', type: 'text', nullable: true })
  oldValue?: string | null;

  @Column({ name: 'new_value', type: 'text', nullable: true })
  newValue?: string | null;

  @Column({ name: 'changed_by' })
  changedBy!: string;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;

  @Column()
  reason!: string;
}
