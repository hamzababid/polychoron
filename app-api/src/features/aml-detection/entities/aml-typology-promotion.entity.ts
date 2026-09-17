import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'aml_typology_promotions' })
export class AmlTypologyPromotion {
  @PrimaryGeneratedColumn('uuid', { name: 'promotion_id' })
  promotionId!: string;

  @Column({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ name: 'promoted_version', type: 'int' })
  promotedVersion!: number;

  // Nullable, but a promotion with no linked backtest must be visibly
  // flagged in the UI, never silently allowed (acceptance criteria).
  @Column({ name: 'backtest_job_id', nullable: true })
  backtestJobId?: string;

  @Column({ name: 'promoted_by' })
  promotedBy!: string;

  @Column({ name: 'promoted_at', type: 'timestamptz' })
  promotedAt!: Date;
}
