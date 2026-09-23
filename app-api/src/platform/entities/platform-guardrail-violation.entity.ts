import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::GuardrailViolation
 * specs/platform/11-evals-and-guardrails-framework.md.
 *
 * READ-ONLY from app-api — agent-service is the only writer (it's the
 * one that actually runs the guardrail checks). Same read/write split
 * as PlatformAgentActivityLog. */
@Entity({ name: 'platform_guardrail_violations' })
export class PlatformGuardrailViolation {
  @PrimaryGeneratedColumn('uuid', { name: 'violation_id' })
  violationId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'suite_code' })
  suiteCode!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'external_case_ref' })
  externalCaseRef!: string;

  @Column({ name: 'guardrail_type' })
  guardrailType!: string;

  @Column({ name: 'node_name' })
  nodeName!: string;

  @Column()
  severity!: string;

  @Column()
  details!: string;

  @Column({ name: 'detected_at', type: 'timestamptz' })
  detectedAt!: Date;
}
