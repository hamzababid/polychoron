import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';

export enum RiskTier {
  CRITICAL = 'critical',
  HIGH = 'high',
  MEDIUM = 'medium',
  LOW = 'low',
}

/** specs/suites/bfsi/features/aml-detection/data-models.py::InboundAlert
 * The raw payload received via webhook from the bank's existing TMS —
 * Polychoron AI does not generate this. */
export class InboundAlertDto {
  @IsString()
  source_alert_id!: string;

  @IsString()
  source_system!: string;

  @IsString()
  customer_id!: string;

  @IsArray()
  @IsString({ each: true })
  account_ids!: string[];

  @IsArray()
  @IsString({ each: true })
  transaction_refs!: string[];

  @IsString()
  rule_fired!: string;

  @IsOptional()
  @IsEnum(RiskTier)
  risk_tier_hint?: RiskTier;
}
