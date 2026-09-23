import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::FairnessMonitoringSnapshot
 * specs/platform/11-evals-and-guardrails-framework.md, eval E5.
 *
 * READ-ONLY from app-api — agent-service computes and writes these;
 * app-api only surfaces flagged segments on Model Governance & Audit. */
@Entity({ name: 'platform_fairness_monitoring_snapshots' })
export class PlatformFairnessMonitoringSnapshot {
  @PrimaryGeneratedColumn('uuid', { name: 'snapshot_id' })
  snapshotId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'period_start', type: 'timestamptz' })
  periodStart!: Date;

  @Column({ name: 'period_end', type: 'timestamptz' })
  periodEnd!: Date;

  @Column({ name: 'segment_dimension' })
  segmentDimension!: string;

  @Column({ name: 'segment_value' })
  segmentValue!: string;

  @Column({ name: 'str_recommendation_rate', type: 'double precision' })
  strRecommendationRate!: number;

  @Column({ name: 'false_positive_rate', type: 'double precision' })
  falsePositiveRate!: number;

  @Column({ name: 'baseline_deviation', type: 'double precision' })
  baselineDeviation!: number;

  @Column({ default: false })
  flagged!: boolean;
}
