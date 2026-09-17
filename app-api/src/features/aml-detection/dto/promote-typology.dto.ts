import { IsOptional, IsString } from 'class-validator';

export class PromoteTypologyDto {
  @IsOptional()
  @IsString()
  backtest_job_id?: string;

  @IsString()
  reason!: string;

  @IsString()
  promoted_by!: string;
}
