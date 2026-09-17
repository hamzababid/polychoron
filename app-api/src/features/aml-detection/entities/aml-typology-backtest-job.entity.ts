import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum BacktestJobStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETE = 'complete',
  FAILED = 'failed',
}

@Entity({ name: 'aml_typology_backtest_jobs' })
export class AmlTypologyBacktestJob {
  @PrimaryGeneratedColumn('uuid', { name: 'job_id' })
  jobId!: string;

  @Column({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ type: 'text', default: BacktestJobStatus.QUEUED })
  status!: BacktestJobStatus;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date;

  @Column({ name: 'comparison_report', type: 'jsonb', nullable: true })
  comparisonReport?: Record<string, unknown>;
}
