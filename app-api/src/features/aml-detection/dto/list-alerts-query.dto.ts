import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { CaseStatus } from '../entities/aml-case.entity.js';

/** screens/02-alert-queue.md — "Sorting, filtering and views". Every
 * filter is server-side; multi-selects arrive comma-separated
 * (`status=open,claimed`) and are validated value by value. */

export const RISK_TIER_OPTIONS = ['critical', 'high', 'medium', 'low', 'unscored'] as const;
export const RECOMMENDATION_OPTIONS = ['clear', 'escalate', 'recommend_str', 'recommend_ctr', 'none'] as const;
export const AGENT_STATE_OPTIONS = ['needs_attention', 'processing', 'not_run', 'assessed', 'stalled', 'kill_switch'] as const;
export const SORT_OPTIONS = ['received', 'risk', 'sla', 'customer', 'status'] as const;
export const SLA_OPTIONS = ['past', 'due_24h'] as const;

export type RiskTierOption = (typeof RISK_TIER_OPTIONS)[number];
export type RecommendationOption = (typeof RECOMMENDATION_OPTIONS)[number];
export type AgentStateOption = (typeof AGENT_STATE_OPTIONS)[number];
export type SortOption = (typeof SORT_OPTIONS)[number];
export type SlaOption = (typeof SLA_OPTIONS)[number];

const csv = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : value;

export class ListAlertsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Transform(csv)
  @IsIn(Object.values(CaseStatus), { each: true })
  status?: CaseStatus[];

  @IsOptional()
  @Transform(csv)
  @IsIn(RISK_TIER_OPTIONS, { each: true })
  risk_tier?: RiskTierOption[];

  // Typology codes, plus `none` for cases with no typology match.
  @IsOptional()
  @Transform(csv)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  typology?: string[];

  @IsOptional()
  @Transform(csv)
  @IsIn(RECOMMENDATION_OPTIONS, { each: true })
  recommendation?: RecommendationOption[];

  // `me`, `unassigned`, or a user ID.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  assignee?: string;

  @IsOptional()
  @IsISO8601()
  received_from?: string;

  // Exclusive upper bound.
  @IsOptional()
  @IsISO8601()
  received_to?: string;

  // The "new alerts since you loaded" check: strictly after this instant.
  @IsOptional()
  @IsISO8601()
  received_after?: string;

  @IsOptional()
  @IsIn(SLA_OPTIONS)
  sla?: SlaOption;

  @IsOptional()
  @Transform(csv)
  @IsIn(AGENT_STATE_OPTIONS, { each: true })
  agent_state?: AgentStateOption[];

  @IsOptional()
  @IsIn(SORT_OPTIONS)
  sort?: SortOption = 'received';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc' = 'desc';

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
