import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::PlatformAgentActivityLogEntry
 *
 * READ-ONLY from app-api. agent-service is the only writer (constitution
 * rule 3 + 09-backend-service-boundary-spec.md's ownership table) — this
 * entity exists so screen-facing endpoints (e.g. Case Workspace's
 * activity-log endpoint) can query it, never so app-api can insert/update
 * rows here. Do not add a repository .save()/.insert() call against this
 * entity anywhere in app-api. */
@Entity({ name: 'platform_agent_activity_log' })
export class PlatformAgentActivityLog {
  @PrimaryGeneratedColumn('uuid', { name: 'log_id' })
  logId!: string;

  @Column({ name: 'tenant_id' })
  tenantId!: string;

  @Column({ name: 'suite_code' })
  suiteCode!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'external_case_ref' })
  externalCaseRef!: string;

  @Column({ name: 'agent_name' })
  agentName!: string;

  @Column({ name: 'agent_version' })
  agentVersion!: string;

  @Column({ name: 'model_provider' })
  modelProvider!: string;

  @Column({ name: 'input_payload', type: 'jsonb' })
  inputPayload!: Record<string, unknown>;

  @Column({ name: 'output_payload', type: 'jsonb' })
  outputPayload!: Record<string, unknown>;

  @Column({ type: 'double precision', nullable: true })
  confidence?: number;

  @Column({ name: 'latency_ms', type: 'int' })
  latencyMs!: number;

  @Column({ name: 'data_sources_queried', type: 'text', array: true, default: '{}' })
  dataSourcesQueried!: string[];

  @Column({ name: 'timestamp', type: 'timestamptz' })
  timestamp!: Date;
}
