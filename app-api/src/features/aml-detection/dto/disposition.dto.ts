import { IsBoolean, IsEnum, IsOptional, IsString, ValidateIf } from 'class-validator';
import { DispositionType } from '../entities/aml-disposition.entity.js';

/** specs/suites/bfsi/features/aml-detection/data-models.py::Disposition
 * The DB-layer CHECK constraint (aml_dispositions_override_reason_required)
 * is the authoritative enforcement of constitution rule 4 — this
 * class-validator check exists only to give a clean 400 instead of a
 * raw DB error for the common case. */
export class DispositionDto {
  @IsString()
  officer_id!: string;

  @IsEnum(DispositionType)
  disposition_type!: DispositionType;

  @IsString()
  officer_notes!: string;

  @IsOptional()
  @IsBoolean()
  overrides_agent_recommendation?: boolean;

  @ValidateIf((dto: DispositionDto) => dto.overrides_agent_recommendation === true)
  @IsString()
  override_reason?: string;
}
