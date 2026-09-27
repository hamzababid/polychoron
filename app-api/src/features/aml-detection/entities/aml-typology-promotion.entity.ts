import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only (migration 014's guard). A promotion names the passing
 * golden-dataset regression run it was gated on; `backtestJobId` stays
 * optional but a null is flagged in the UI, never silently allowed
 * (acceptance criteria). `preV2` marks rows recorded before the
 * lifecycle existed, whose reason wasn't stored. */
@Entity({ name: 'aml_typology_promotions' })
export class AmlTypologyPromotion {
  @PrimaryGeneratedColumn('uuid', { name: 'promotion_id' })
  promotionId!: string;

  @Column({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ name: 'promoted_version', type: 'int' })
  promotedVersion!: number;

  @Column({ name: 'backtest_job_id', type: 'uuid', nullable: true })
  backtestJobId!: string | null;

  @Column({ name: 'eval_run_id', type: 'uuid', nullable: true })
  evalRunId!: string | null;

  @Column()
  reason!: string;

  @Column({ name: 'pre_v2' })
  preV2!: boolean;

  @Column({ name: 'promoted_by' })
  promotedBy!: string;

  @Column({ name: 'promoted_at', type: 'timestamptz' })
  promotedAt!: Date;
}
