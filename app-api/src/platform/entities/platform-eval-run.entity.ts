import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::EvalRun
 * specs/platform/11-evals-and-guardrails-framework.md, eval E1.
 *
 * READ-ONLY from app-api — agent-service runs the golden-dataset
 * regression and writes these rows; app-api only surfaces them on
 * Model Governance & Audit. */
@Entity({ name: 'platform_eval_runs' })
export class PlatformEvalRun {
  @PrimaryGeneratedColumn('uuid', { name: 'run_id' })
  runId!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'agent_version_under_test' })
  agentVersionUnderTest!: string;

  @Column({ name: 'triggered_by' })
  triggeredBy!: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt?: Date | null;

  @Column({ name: 'total_cases', type: 'int' })
  totalCases!: number;

  @Column({ type: 'int' })
  passed!: number;

  @Column({ type: 'int' })
  failed!: number;

  @Column({ name: 'faithfulness_score_avg', type: 'double precision', nullable: true })
  faithfulnessScoreAvg?: number | null;

  @Column({ name: 'consistency_variance', type: 'double precision', nullable: true })
  consistencyVariance?: number | null;

  @Column()
  status!: string;
}
