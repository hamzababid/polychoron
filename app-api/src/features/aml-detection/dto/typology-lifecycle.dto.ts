import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** screens/06-typology-rules-console.md. No `*_by` field anywhere: the
 * acting user always comes from the session. */

export const TYPOLOGY_CODE_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;

export class CreateTypologyDto {
  @Matches(TYPOLOGY_CODE_PATTERN, {
    message: 'typology_code must be 3–64 chars of lowercase letters, digits and underscores, starting with a letter',
  })
  typology_code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  typology_label!: string;

  @IsString()
  @IsNotEmpty()
  rule_logic_description!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class UpdateDraftDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  typology_label?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  rule_logic_description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  change_reason?: string;
}

export class DiscardDraftDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}
