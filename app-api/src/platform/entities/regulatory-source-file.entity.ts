import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/10-regulatory-knowledge-base-spec.md, "Phase 2
 * addendum" — the original uploaded or fetched bytes behind a
 * regulatory document, retained so every citation traces back to the
 * source publication.
 *
 * WRITTEN BY app-api (spec 09's ownership table): an upload can be
 * 20 MB and Temporal payloads cap around 2 MB, so app-api stores the
 * bytes and hands agent-service only the file_id. `content` is
 * excluded from default SELECTs (same pattern as
 * AmlReportGeneration.fileContent). */
@Entity({ name: 'regulatory_source_files' })
export class RegulatorySourceFile {
  @PrimaryGeneratedColumn('uuid', { name: 'file_id' })
  fileId!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column()
  filename!: string;

  @Column({ name: 'content_type' })
  contentType!: string;

  @Column({ name: 'size_bytes', type: 'int' })
  sizeBytes!: number;

  @Column()
  sha256!: string;

  @Column({ name: 'fetched_from_url', type: 'text', nullable: true })
  fetchedFromUrl?: string | null;

  @Column({ type: 'bytea', select: false })
  content!: Buffer;

  @Column({ name: 'uploaded_by' })
  uploadedBy!: string;

  @CreateDateColumn({ name: 'uploaded_at' })
  uploadedAt!: Date;
}
