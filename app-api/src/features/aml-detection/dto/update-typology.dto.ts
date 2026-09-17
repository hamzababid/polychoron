import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateTypologyDto {
  @IsOptional()
  @IsString()
  rule_logic_description?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsString()
  change_reason!: string;

  @IsString()
  changed_by!: string;
}
