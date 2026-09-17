import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md
 * "FMUFollowup" — minimally scoped append-only note log per filing. */
@Entity({ name: 'aml_fmu_followups' })
export class AmlFmuFollowup {
  @PrimaryGeneratedColumn('uuid', { name: 'followup_id' })
  followupId!: string;

  @Column({ name: 'filing_id' })
  filingId!: string;

  @Column()
  note!: string;

  @Column({ name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
