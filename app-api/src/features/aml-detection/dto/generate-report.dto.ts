import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class GenerateReportDto {
  @IsString()
  report_name!: string;

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

  // Format's CHECK constraint only allows 'csv' today (no PDF library
  // in app-api yet) — validated here too so a bad request 400s before
  // ever reaching the DB constraint.
  @IsIn(['csv'])
  format!: 'csv';

  @IsString()
  generated_by!: string;
}
