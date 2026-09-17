import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { CaseStatus } from '../entities/aml-case.entity.js';
import type { RiskTierFilter } from '../sla.js';

const RISK_TIERS: RiskTierFilter[] = ['critical', 'high', 'medium', 'low'];

export class ListAlertsQueryDto {
  @IsOptional()
  @IsEnum(CaseStatus)
  status?: CaseStatus;

  @IsOptional()
  @IsIn(RISK_TIERS)
  risk_tier?: RiskTierFilter;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
