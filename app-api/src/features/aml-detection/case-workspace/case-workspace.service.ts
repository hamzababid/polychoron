import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AmlCase } from '../entities/aml-case.entity.js';
import { FEATURE_CODE } from '../aml-detection.service.js';

export interface CaseDetail {
  caseId: string;
  tenantId: string;
  alert: Record<string, unknown>;
  status: string;
  assignedAnalystId: string | null;
  createdAt: string;
  closedAt: string | null;
  evidence: Record<string, unknown> | null;
  typologyMatch: Record<string, unknown> | null;
  assessment: Record<string, unknown> | null;
  disposition: Record<string, unknown> | null;
  filing: Record<string, unknown> | null;
}

export interface ActivityLogEntry {
  logId: string;
  agentName: string;
  agentVersion: string;
  modelProvider: string;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  confidence: number | null;
  latencyMs: number;
  dataSourcesQueried: string[];
  timestamp: string;
}

@Injectable()
export class CaseWorkspaceService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getCaseDetail(caseId: string): Promise<CaseDetail> {
    const amlCase = await this.dataSource.getRepository(AmlCase).findOneBy({ caseId });
    if (!amlCase) {
      throw new NotFoundException(`No AML case with case_id=${caseId}`);
    }

    const [evidenceRows, typologyRows, assessmentRows, dispositionRows, filingRows] = await Promise.all([
      this.dataSource.query('SELECT * FROM aml_evidence_bundles WHERE case_id = $1', [caseId]),
      this.dataSource.query('SELECT * FROM aml_typology_matches WHERE case_id = $1', [caseId]),
      this.dataSource.query('SELECT * FROM aml_case_assessments WHERE case_id = $1', [caseId]),
      this.dataSource.query('SELECT * FROM aml_dispositions WHERE case_id = $1', [caseId]),
      this.dataSource.query('SELECT * FROM aml_str_filings WHERE case_id = $1', [caseId]),
    ]);

    return {
      caseId: amlCase.caseId,
      tenantId: amlCase.tenantId,
      alert: amlCase.alert,
      status: amlCase.status,
      assignedAnalystId: amlCase.assignedAnalystId ?? null,
      createdAt: amlCase.createdAt.toISOString(),
      closedAt: amlCase.closedAt ? amlCase.closedAt.toISOString() : null,
      evidence: evidenceRows[0] ?? null,
      typologyMatch: typologyRows[0] ?? null,
      assessment: assessmentRows[0] ?? null,
      disposition: dispositionRows[0] ?? null,
      filing: filingRows[0] ?? null,
    };
  }

  async getActivityLog(caseId: string): Promise<ActivityLogEntry[]> {
    const rows = (await this.dataSource.query(
      `SELECT log_id, agent_name, agent_version, model_provider, input_payload, output_payload,
              confidence, latency_ms, data_sources_queried, "timestamp"
       FROM platform_agent_activity_log
       WHERE feature_code = $1 AND external_case_ref = $2
       ORDER BY "timestamp" ASC`,
      [FEATURE_CODE, caseId],
    )) as Array<{
      log_id: string;
      agent_name: string;
      agent_version: string;
      model_provider: string;
      input_payload: Record<string, unknown>;
      output_payload: Record<string, unknown>;
      confidence: number | null;
      latency_ms: number;
      data_sources_queried: string[];
      timestamp: Date;
    }>;

    return rows.map((r) => ({
      logId: r.log_id,
      agentName: r.agent_name,
      agentVersion: r.agent_version,
      modelProvider: r.model_provider,
      inputPayload: r.input_payload,
      outputPayload: r.output_payload,
      confidence: r.confidence,
      latencyMs: r.latency_ms,
      dataSourcesQueried: r.data_sources_queried,
      timestamp: new Date(r.timestamp).toISOString(),
    }));
  }
}
