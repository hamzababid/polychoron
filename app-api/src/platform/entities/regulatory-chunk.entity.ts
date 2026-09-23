import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/10-regulatory-knowledge-base-spec.md::RegulatoryChunk
 *
 * READ-ONLY from app-api, same reasoning as RegulatoryDocument. The
 * `embedding` pgvector column is deliberately omitted — app-api never
 * needs the raw vector, only section_reference/text for the
 * management screen's chunk list/preview. */
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
}
