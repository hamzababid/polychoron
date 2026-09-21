import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum AgentRecommendation {
  CLEAR = 'clear',
  ESCALATE = 'escalate',
  RECOMMEND_STR = 'recommend_str',
  RECOMMEND_CTR = 'recommend_ctr',
}

/** specs/suites/bfsi/features/aml-detection/data-models.py::CaseAssessment
 * READ-ONLY from app-api — written exclusively by agent-service's Case
 * and Narrative Agent. str_fields_draft has no suspicion-rationale
 * field by construction (constitution-addendum A1) — do not add one. */
@Entity({ name: 'aml_case_assessments' })
export class AmlCaseAssessment {
  @PrimaryColumn({ name: 'case_id' })
  caseId!: string;

  @Column({ name: 'risk_score', type: 'int' })
  riskScore!: number;

  @Column({ type: 'text' })
  recommendation!: AgentRecommendation;

  @Column({ name: 'recommendation_confidence', type: 'double precision' })
  recommendationConfidence!: number;

  @Column({ name: 'draft_narrative' })
  draftNarrative!: string;

  @Column({ name: 'str_fields_draft', type: 'jsonb', nullable: true })
  strFieldsDraft?: Record<string, unknown>;

  /** ADDITIVE (specs/platform/10-regulatory-knowledge-base-spec.md) —
   * same non-decisional supporting-context role as
   * AmlTypologyMatch.regulatoryCitations. Currently unpopulated: only
   * the Pattern Matching node's retrieval call is wired up so far. */
  @Column({ name: 'regulatory_context_used', type: 'jsonb' })
  regulatoryContextUsed!: Record<string, unknown>[];

  @Column({ name: 'assessed_at', type: 'timestamptz' })
  assessedAt!: Date;

  @Column({ name: 'agent_version' })
  agentVersion!: string;
}
