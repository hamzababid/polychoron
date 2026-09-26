import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type TypologyVersionStatus = 'draft' | 'promoted' | 'superseded' | 'discarded';

/** One row per version of a typology's content (migration 014). Only a
 * `draft` is editable; everything else is immutable at the DB layer.
 * `contentHash` is a generated column — the regression run that gates
 * promotion is keyed to it. */
@Entity({ name: 'aml_typology_config_versions' })
export class AmlTypologyConfigVersion {
  @PrimaryGeneratedColumn('uuid', { name: 'version_id' })
  versionId!: string;

  @Column({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ name: 'typology_label' })
  typologyLabel!: string;

  @Column({ name: 'rule_logic_description' })
  ruleLogicDescription!: string;

  @Column()
  active!: boolean;

  @Column({ type: 'text' })
  status!: TypologyVersionStatus;

  @Column({ name: 'content_hash', insert: false, update: false })
  contentHash!: string;

  @Column({ name: 'changed_by' })
  changedBy!: string;

  @Column({ name: 'changed_at', type: 'timestamptz' })
  changedAt!: Date;

  @Column({ name: 'change_reason' })
  changeReason!: string;

  @Column({ name: 'discarded_by', type: 'text', nullable: true })
  discardedBy!: string | null;

  @Column({ name: 'discarded_at', type: 'timestamptz', nullable: true })
  discardedAt!: Date | null;

  @Column({ name: 'discard_reason', type: 'text', nullable: true })
  discardReason!: string | null;
}
