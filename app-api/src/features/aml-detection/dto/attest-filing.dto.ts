import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ReportType } from '../entities/aml-str-filing.entity.js';
import { StrFieldsDraftDto } from './str-fields-draft.dto.js';

/** specs/suites/bfsi/features/aml-detection/data-models.py::OfficerAttestation
 * Also accepts the officer's edits to the agent's draft (payload/
 * final_narrative/report_type) — screens/04-filing-console.md's "Save
 * as draft" interaction saves both together; submission_status stays
 * DRAFT regardless of whether attestation_confirmed is true here
 * (that's only checked, server-side again, at submit time). */
export class AttestFilingDto {
  @IsString()
  officer_id!: string;

  @IsString()
  officer_name!: string;

  @IsString()
  officer_role!: string;

  @IsBoolean()
  tipping_off_checklist_complete!: boolean;

  @IsBoolean()
  attestation_confirmed!: boolean;

  @IsOptional()
  @IsEnum(ReportType)
  report_type?: ReportType;

  @IsOptional()
  @ValidateNested()
  @Type(() => StrFieldsDraftDto)
  payload?: StrFieldsDraftDto;

  @IsOptional()
  @IsString()
  final_narrative?: string;
}
