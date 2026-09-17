import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/screens/04-filing-console.md
 * acceptance criterion: officer overrides of agent-drafted filing
 * fields (e.g. the typology tag) are logged — who, what, when. */
@Entity({ name: 'aml_filing_edits' })
export class AmlFilingEdit {
  @PrimaryGeneratedColumn('uuid', { name: 'edit_id' })
  editId!: string;

  @Column({ name: 'case_id' })
  caseId!: string;

  @Column({ name: 'officer_id' })
  officerId!: string;

  @Column({ name: 'field_name' })
  fieldName!: string;

  @Column({ name: 'old_value', nullable: true })
  oldValue?: string;

  @Column({ name: 'new_value', nullable: true })
  newValue?: string;

  @CreateDateColumn({ name: 'changed_at' })
  changedAt!: Date;
}
