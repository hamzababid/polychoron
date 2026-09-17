import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only — every rule-logic edit *and* every active/inactive
 * toggle writes a row (screens/06-typology-rules-console.md). */
@Entity({ name: 'aml_typology_config_versions' })
export class AmlTypologyConfigVersion {
  @PrimaryGeneratedColumn('uuid', { name: 'version_id' })
  versionId!: string;

  @Column({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ name: 'rule_logic_description' })
  ruleLogicDescription!: string;

  @Column()
  active!: boolean;

  @Column({ name: 'changed_by' })
  changedBy!: string;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;

  @Column({ name: 'change_reason' })
  changeReason!: string;
}
