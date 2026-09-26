import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/10-regulatory-knowledge-base-spec.md::RegulatoryDocument
 *
 * READ-ONLY from app-api — agent-service's Regulatory Knowledge Base
 * ingestion pipeline (app/platform/regulatory/) is the only writer,
 * triggered by app-api's regulatory-kb endpoints via a Temporal
 * workflow, never a direct write here — chunking a document means
 * generating embeddings, which per
 * specs/platform/09-backend-service-boundary-spec.md is Python's job
 * ("NestJS never calls an LLM directly"). Do not add a
 * repository .save()/.insert() call against this entity in app-api. */
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
}
