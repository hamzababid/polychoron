import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Client } from '@temporalio/client';
import { AmlCase, CaseStatus } from './entities/aml-case.entity.js';
import { AmlDisposition, DispositionType } from './entities/aml-disposition.entity.js';
import { FeatureCaseEnvelope, type PlatformUser } from '../../platform/entities/index.js';
import { InboundAlertDto } from './dto/inbound-alert.dto.js';
import { DispositionDto } from './dto/disposition.dto.js';
import { TEMPORAL_CLIENT } from '../../common/temporal/temporal.module.js';

// specs/suites/bfsi/features/aml-detection/screens/03-case-workspace.md:
// "DemoRole.ANALYST can investigate/disposition up to escalate;
// DemoRole.COMPLIANCE_OFFICER can additionally file." Enforced
// server-side, not just by hiding the buttons in the UI (constitution
// rule 7).
const FILING_DISPOSITIONS = new Set([DispositionType.FILE_STR, DispositionType.FILE_CTR]);
const FILING_ROLES = ['aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head'];

export const SUITE_CODE = 'bfsi';
export const FEATURE_CODE = 'aml_detection';

export interface IngestResult {
  caseId: string;
  status: CaseStatus;
  workflowId: string;
}

// The case's next status once an officer's Disposition resolves it —
// direct consequence of which disposition_type was recorded, not a
// separate business rule to reinvent per screen.
const STATUS_AFTER_DISPOSITION: Record<DispositionType, CaseStatus> = {
  [DispositionType.CLEAR]: CaseStatus.CLEARED,
  [DispositionType.ENHANCED_MONITORING]: CaseStatus.INVESTIGATING,
  [DispositionType.ESCALATE_SENIOR]: CaseStatus.ESCALATED,
  [DispositionType.FILE_STR]: CaseStatus.PENDING_FILING,
  [DispositionType.FILE_CTR]: CaseStatus.PENDING_FILING,
};

@Injectable()
export class AmlDetectionService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(TEMPORAL_CLIENT) private readonly temporalClient: Client,
    private readonly config: ConfigService,
  ) {}

  /**
   * specs/platform/09-backend-service-boundary-spec.md: app-api writes
   * Case + FeatureCaseEnvelope in one transaction, then starts the
   * Python-defined workflow via Temporal's TS client — never a direct
   * HTTP call to agent-service for this.
   */
  async ingestAlert(dto: InboundAlertDto): Promise<IngestResult> {
    const tenantId = this.config.get<string>('DEMO_TENANT_ID', 'demo-northbridge-bank');
    const receivedAt = new Date();
    // Plain object, not a spread of the DTO class instance, so the
    // stored/relayed payload is a clean data shape rather than
    // carrying the DTO's class prototype along with it.
    const alertPayload = {
      source_alert_id: dto.source_alert_id,
      source_system: dto.source_system,
      customer_id: dto.customer_id,
      account_ids: dto.account_ids,
      transaction_refs: dto.transaction_refs,
      rule_fired: dto.rule_fired,
      risk_tier_hint: dto.risk_tier_hint,
      received_at: receivedAt.toISOString(),
    };

    const { caseId } = await this.dataSource.transaction(async (manager) => {
      const savedCase = await manager.save(AmlCase, {
        tenantId,
        alert: alertPayload,
        status: CaseStatus.OPEN,
      });

      await manager.save(FeatureCaseEnvelope, {
        tenantId,
        suiteCode: SUITE_CODE,
        featureCode: FEATURE_CODE,
        externalCaseRef: savedCase.caseId,
        status: CaseStatus.OPEN,
        riskTier: dto.risk_tier_hint,
        summaryTitle: `${dto.rule_fired} — Cust ${dto.customer_id}`,
      });

      return { caseId: savedCase.caseId };
    });

    const taskQueue = this.config.get<string>('TEMPORAL_TASK_QUEUE', 'aml_detection-task-queue');
    const workflowId = `aml-case-${caseId}`;

    await this.temporalClient.workflow.start('AmlDetectionWorkflow', {
      taskQueue,
      workflowId,
      args: [{ ...alertPayload, case_ref: caseId, tenant_id: tenantId }],
    });

    return { caseId, status: CaseStatus.OPEN, workflowId };
  }

  /**
   * Records the officer's Disposition and sends it as a signal to the
   * paused workflow — the "human checkpoint resume" pattern from
   * specs/platform/09-backend-service-boundary-spec.md. Never a direct
   * HTTP call to agent-service for this either.
   */
  async recordDisposition(
    caseId: string,
    dto: DispositionDto,
    user: PlatformUser,
  ): Promise<{ caseId: string; status: CaseStatus }> {
    const existingCase = await this.dataSource.getRepository(AmlCase).findOneBy({ caseId });
    if (!existingCase) {
      throw new NotFoundException(`No AML case with case_id=${caseId}`);
    }

    if (FILING_DISPOSITIONS.has(dto.disposition_type) && !user.roleCodes.some((c) => FILING_ROLES.includes(c))) {
      throw new ForbiddenException('Only a senior compliance officer can record a filing disposition');
    }

    const newStatus = STATUS_AFTER_DISPOSITION[dto.disposition_type];

    await this.dataSource.transaction(async (manager) => {
      await manager.save(AmlDisposition, {
        caseId,
        officerId: dto.officer_id,
        dispositionType: dto.disposition_type,
        officerNotes: dto.officer_notes,
        overridesAgentRecommendation: dto.overrides_agent_recommendation ?? false,
        overrideReason: dto.override_reason,
      });
      await manager.update(AmlCase, { caseId }, { status: newStatus });
    });

    const workflowId = `aml-case-${caseId}`;
    const handle = this.temporalClient.workflow.getHandle(workflowId);
    await handle.signal('disposition', {
      officer_id: dto.officer_id,
      disposition_type: dto.disposition_type,
      decided_at: new Date().toISOString(),
    });

    return { caseId, status: newStatus };
  }
}
