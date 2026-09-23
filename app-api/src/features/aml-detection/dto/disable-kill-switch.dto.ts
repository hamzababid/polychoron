import { IsOptional, IsString } from 'class-validator';

export class DisableKillSwitchDto {
  /** Omit to disable the entire feature; set to disable one typology only. */
  @IsOptional()
  @IsString()
  typology_code?: string;

  @IsString()
  reason!: string;

  @IsString()
  disabled_by!: string;
}
