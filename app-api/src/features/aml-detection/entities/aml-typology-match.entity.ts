import { Column, Entity, PrimaryColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/data-models.py::TypologyMatch
 * READ-ONLY from app-api — written exclusively by agent-service's
 * Pattern Matching Agent. */
@Entity({ name: 'aml_typology_matches' })
export class AmlTypologyMatch {
  @PrimaryColumn({ name: 'case_id' })
  caseId!: string;

  @Column({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ name: 'typology_label' })
  typologyLabel!: string;

  @Column({ type: 'double precision' })
  confidence!: number;

  @Column({ name: 'matched_indicators', type: 'jsonb' })
  matchedIndicators!: Record<string, unknown>[];

  @Column({ name: 'plain_language_rationale' })
  plainLanguageRationale!: string;

  /** ADDITIVE (specs/platform/10-regulatory-knowledge-base-spec.md) —
   * supporting context only, never a suspicion determination in itself
   * (constitution-addendum A5). Defaults to [] at the DB layer. */
  @Column({ name: 'regulatory_citations', type: 'jsonb' })
  regulatoryCitations!: Record<string, unknown>[];

  @Column({ name: 'matched_at', type: 'timestamptz' })
  matchedAt!: Date;

  @Column({ name: 'agent_version' })
  agentVersion!: string;
}
