import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional } from 'class-validator';

export class ReportingSummaryQueryDto {
  @IsISO8601()
  period_start!: string;

  @IsISO8601()
  period_end!: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  compare_previous?: boolean = false;

  @IsOptional()
  @IsIn(['type', 'typology', 'branch'])
  breakdown_by?: 'type' | 'typology' | 'branch' = 'type';
}
