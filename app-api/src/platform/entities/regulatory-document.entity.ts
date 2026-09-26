import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/10-regulatory-knowledge-base-spec.md::RegulatoryDocument
 *
 * READ-ONLY from app-api — agent-service owns writes to this table
 * (specs/platform/09-backend-service-boundary-spec.md). app-api changes
 * it only through awaited Temporal commands
 * (regulatory-kb-commands.service.ts), never a direct write here. Do
 * not add a repository .save()/.insert() call against this entity.
 *
 * Lifecycle columns: specs/platform/10-regulatory-knowledge-base-spec.md,
 * "Phase 2 addendum". extracted_text (draft working copy, potentially
 * large) is excluded from default SELECTs. */
@Entity({ name: 'regulatory_documents' })
export class RegulatoryDocument {
  @PrimaryGeneratedColumn('uuid', { name: 'document_id' })
  documentId!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column()
  title!: string;

  @Column({ name: 'source_type' })
  sourceType!: string;

  @Column({ name: 'issuing_authority' })
  issuingAuthority!: string;

  @Column({ name: 'version_label' })
  versionLabel!: string;

  @Column({ name: 'effective_date', type: 'timestamptz', nullable: true })
  effectiveDate?: Date | null;

  @Column({ name: 'superseded_by', type: 'uuid', nullable: true })
  supersededBy?: string | null;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl?: string | null;

  @CreateDateColumn({ name: 'ingested_at' })
  ingestedAt!: Date;

  @Column({ name: 'ingested_by' })
  ingestedBy!: string;

  @Column({ type: 'text' })
  status!: 'draft' | 'current' | 'superseded' | 'withdrawn';

  @Column({ name: 'document_family_id', type: 'uuid' })
  documentFamilyId!: string;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber!: number;

  @Column()
  jurisdiction!: string;

  @Column()
  language!: string;

  @Column({ type: 'text', array: true })
  tags!: string[];

  @Column({ name: 'related_typology_codes', type: 'text', array: true })
  relatedTypologyCodes!: string[];

  @Column({ name: 'retrieval_enabled' })
  retrievalEnabled!: boolean;

  @Column({ name: 'retrieval_priority', type: 'double precision' })
  retrievalPriority!: number;

  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  @Column({ name: 'source_method', type: 'text' })
  sourceMethod!: string;

  @Column({ name: 'source_file_id', type: 'uuid', nullable: true })
  sourceFileId?: string | null;

  @Column({ name: 'chunking_config', type: 'jsonb', nullable: true })
  chunkingConfig?: Record<string, unknown> | null;

  @Column({ name: 'extracted_text', type: 'text', nullable: true, select: false })
  extractedText?: string | null;

  @Column({ name: 'published_by', type: 'text', nullable: true })
  publishedBy?: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Column({ name: 'withdrawn_by', type: 'text', nullable: true })
  withdrawnBy?: string | null;

  @Column({ name: 'withdrawn_at', type: 'timestamptz', nullable: true })
  withdrawnAt?: Date | null;

  @Column({ name: 'withdrawal_reason', type: 'text', nullable: true })
  withdrawalReason?: string | null;
}
