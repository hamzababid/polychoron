import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/10-regulatory-knowledge-base-spec.md::RegulatoryChunk
 *
 * READ-ONLY from app-api, same reasoning as RegulatoryDocument. The
 * `embedding` pgvector column is deliberately omitted — app-api never
 * needs the raw vector; "is it embedded" is read with a raw
 * `embedding IS NOT NULL` where needed. */
@Entity({ name: 'regulatory_chunks' })
export class RegulatoryChunk {
  @PrimaryGeneratedColumn('uuid', { name: 'chunk_id' })
  chunkId!: string;

  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  @Column({ name: 'section_reference' })
  sectionReference!: string;

  @Column()
  text!: string;

  @Column({ type: 'int' })
  ordinal!: number;

  @Column({ name: 'char_count', type: 'int' })
  charCount!: number;

  @Column({ name: 'injection_flags', type: 'text', array: true })
  injectionFlags!: string[];

  @Column({ name: 'injection_acknowledged_by', type: 'text', nullable: true })
  injectionAcknowledgedBy?: string | null;
}
