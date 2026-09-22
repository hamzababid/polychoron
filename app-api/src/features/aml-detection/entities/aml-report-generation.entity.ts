import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/screens/10-reporting-mi.md
 * The generated file's bytes live here (file_content), not just a
 * description of how to rebuild it — "re-downloadable byte-for-byte,
 * never regenerated on request" per the screen's acceptance criteria.
 * file_content is excluded by default (select: false) so listing
 * report history never pulls file bytes over the wire — only the
 * download endpoint explicitly re-selects it. */
@Entity({ name: 'aml_report_generations' })
export class AmlReportGeneration {
  @PrimaryGeneratedColumn('uuid', { name: 'report_id' })
  reportId!: string;

  @Column({ name: 'report_name' })
  reportName!: string;

  @Column({ name: 'period_label' })
  periodLabel!: string;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart!: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd!: Date;

  @Column({ name: 'compare_previous' })
  comparePrevious!: boolean;

  @Column({ name: 'breakdown_by' })
  breakdownBy!: string;

  @Column({ type: 'text' })
  format!: string;

  @Column({ name: 'file_name' })
  fileName!: string;

  @Column({ name: 'content_hash' })
  contentHash!: string;

  @Column({ name: 'file_content', type: 'bytea', select: false })
  fileContent!: Buffer;

  @Column({ name: 'generated_by' })
  generatedBy!: string;

  @CreateDateColumn({ name: 'generated_at' })
  generatedAt!: Date;
}
