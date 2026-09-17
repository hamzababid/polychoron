import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource, Repository } from 'typeorm';
import { AmlCase, CaseStatus } from '../entities/aml-case.entity.js';
import { AmlFilingEdit } from '../entities/aml-filing-edit.entity.js';
import { AmlStrFiling, FilingSubmissionStatus, ReportType } from '../entities/aml-str-filing.entity.js';
import { AttestFilingDto } from '../dto/attest-filing.dto.js';
import { StrFieldsDraftDto } from '../dto/str-fields-draft.dto.js';

interface OfficerAttestationShape {
  officer_id: string;
  officer_name: string;
  officer_role: string;
  tipping_off_checklist_complete: boolean;
  attestation_confirmed: boolean;
  attested_at: string;
}

export interface FilingDraftResponse {
  caseId: string;
  riskScore: number;
  recommendation: string;
  strFieldsDraft: StrFieldsDraftDto;
  narrative: string;
  submissionStatus: FilingSubmissionStatus | 'not_yet_drafted';
  goamlReference: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
}

@Injectable()
export class FilingConsoleService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlStrFiling) private readonly filings: Repository<AmlStrFiling>,
    @InjectRepository(AmlFilingEdit) private readonly filingEdits: Repository<AmlFilingEdit>,
  ) {}

  async getFilingDraft(caseId: string): Promise<FilingDraftResponse> {
    const existingFiling = await this.filings.findOneBy({ caseId });
    if (existingFiling) {
      const assessmentForExisting = await this.getAssessment(caseId);
      return {
        caseId,
        riskScore: assessmentForExisting?.risk_score ?? 0,
        recommendation: assessmentForExisting?.recommendation ?? '',
        strFieldsDraft: existingFiling.payload as unknown as StrFieldsDraftDto,
        narrative: existingFiling.finalNarrative,
        submissionStatus: existingFiling.submissionStatus,
        goamlReference: existingFiling.goamlReference ?? null,
        submittedAt: existingFiling.submittedAt ? existingFiling.submittedAt.toISOString() : null,
        acknowledgedAt: existingFiling.acknowledgedAt ? existingFiling.acknowledgedAt.toISOString() : null,
      };
    }

    const assessment = await this.getAssessment(caseId);
    if (!assessment) {
      throw new NotFoundException(`No case assessment yet for case_id=${caseId} — the agent chain may still be running`);
    }
    if (!assessment.str_fields_draft) {
      throw new BadRequestException(
        `Case ${caseId}'s agent assessment did not recommend a filing (recommendation=${assessment.recommendation}) — there is no STR fields draft to review`,
      );
    }

    return {
      caseId,
      riskScore: assessment.risk_score,
      recommendation: assessment.recommendation,
      strFieldsDraft: assessment.str_fields_draft,
      narrative: assessment.draft_narrative,
      submissionStatus: 'not_yet_drafted',
      goamlReference: null,
      submittedAt: null,
      acknowledgedAt: null,
    };
  }

  /**
   * Saves attestation state + any officer edits to the draft.
   * submission_status always stays DRAFT here (screens/04-filing-console.md
   * — "partial data allowed") regardless of whether the attestation is
   * complete; completeness is only checked, server-side, at submit().
   */
  async attest(caseId: string, dto: AttestFilingDto): Promise<FilingDraftResponse> {
    const existingFiling = await this.filings.findOneBy({ caseId });
    if (existingFiling && existingFiling.submissionStatus !== FilingSubmissionStatus.DRAFT) {
      throw new BadRequestException(`Filing for case_id=${caseId} is already ${existingFiling.submissionStatus} — no longer editable`);
    }

    let payload = dto.payload;
    let narrative = dto.final_narrative;
    const reportType = dto.report_type ?? ReportType.STR_F;

    if (!payload || narrative === undefined) {
      const assessment = await this.getAssessment(caseId);
      if (!assessment?.str_fields_draft) {
        throw new BadRequestException(`No agent-drafted STR fields available for case_id=${caseId} to base a filing on`);
      }
      payload ??= assessment.str_fields_draft;
      narrative ??= assessment.draft_narrative;
    }

    await this.logTypologyTagOverrideIfChanged(caseId, dto.officer_id, existingFiling, payload);

    const attestation: OfficerAttestationShape = {
      officer_id: dto.officer_id,
      officer_name: dto.officer_name,
      officer_role: dto.officer_role,
      tipping_off_checklist_complete: dto.tipping_off_checklist_complete,
      attestation_confirmed: dto.attestation_confirmed,
      attested_at: new Date().toISOString(),
    };

    const filingToSave: Partial<AmlStrFiling> = {
      caseId,
      reportType,
      payload: payload as unknown as Record<string, unknown>,
      finalNarrative: narrative,
      attestation: attestation as unknown as Record<string, unknown>,
      submissionStatus: FilingSubmissionStatus.DRAFT,
    };
    if (existingFiling) {
      filingToSave.filingId = existingFiling.filingId;
    }
    await this.filings.save(filingToSave);

    return this.getFilingDraft(caseId);
  }

  /**
   * Re-validates OfficerAttestation.can_submit server-side at the
   * moment of action (constitution rule 1) — never trusts that the
   * frontend only enabled the button because the state was actually
   * true.
   */
  async submit(caseId: string): Promise<FilingDraftResponse> {
    const existingFiling = await this.filings.findOneBy({ caseId });
    if (!existingFiling) {
      throw new NotFoundException(`No filing draft for case_id=${caseId} — attest before submitting`);
    }
    if (existingFiling.submissionStatus !== FilingSubmissionStatus.DRAFT) {
      throw new BadRequestException(`Filing for case_id=${caseId} is already ${existingFiling.submissionStatus}`);
    }

    const attestation = existingFiling.attestation as unknown as OfficerAttestationShape;
    const canSubmit = attestation.tipping_off_checklist_complete && attestation.attestation_confirmed;
    if (!canSubmit) {
      throw new ForbiddenException('OfficerAttestation.can_submit is false — complete the tipping-off checklist and attestation first');
    }

    const submittedAt = new Date();
    const retentionExpiry = new Date(submittedAt);
    retentionExpiry.setFullYear(retentionExpiry.getFullYear() + 10);
    // mock_goaml_submit() — specs/.../mock-bank-integration-spec.md's
    // "goAML mock": returns a fake reference immediately, submission
    // acknowledgment is simulated later via the goAML Tracker's
    // simulate-acknowledgment endpoint.
    const goamlReference = `GOAML-DEMO-${randomUUID().slice(0, 8).toUpperCase()}`;

    await this.filings.update(
      { filingId: existingFiling.filingId },
      {
        submissionStatus: FilingSubmissionStatus.SUBMITTED,
        submittedAt,
        retentionExpiry,
        goamlReference,
      },
    );
    await this.dataSource.getRepository(AmlCase).update({ caseId }, { status: CaseStatus.FILED, closedAt: submittedAt });

    return this.getFilingDraft(caseId);
  }

  private async getAssessment(
    caseId: string,
  ): Promise<{ risk_score: number; recommendation: string; draft_narrative: string; str_fields_draft: StrFieldsDraftDto | null } | null> {
    const rows = (await this.dataSource.query('SELECT * FROM aml_case_assessments WHERE case_id = $1', [caseId])) as Array<{
      risk_score: number;
      recommendation: string;
      draft_narrative: string;
      str_fields_draft: StrFieldsDraftDto | null;
    }>;
    return rows[0] ?? null;
  }

  private async logTypologyTagOverrideIfChanged(
    caseId: string,
    officerId: string,
    existingFiling: AmlStrFiling | null,
    newPayload: StrFieldsDraftDto,
  ): Promise<void> {
    const previousTag = existingFiling
      ? (existingFiling.payload as unknown as StrFieldsDraftDto).typology_tag
      : (await this.getAssessment(caseId))?.str_fields_draft?.typology_tag;

    if (previousTag && previousTag !== newPayload.typology_tag) {
      await this.filingEdits.save({
        caseId,
        officerId,
        fieldName: 'typology_tag',
        oldValue: previousTag,
        newValue: newPayload.typology_tag,
      });
    }
  }
}
