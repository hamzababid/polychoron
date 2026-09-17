import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * Replaces Phase 1's hardcoded typology_catalog.py as the Pattern
 * Matching Agent's typology config source. Owned (writes) by app-api;
 * agent-service reads it. */
@Entity({ name: 'aml_typology_configs' })
export class AmlTypologyConfig {
  @PrimaryColumn({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ name: 'typology_label' })
  typologyLabel!: string;

  @Column({ name: 'rule_logic_description' })
  ruleLogicDescription!: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ name: 'production_version', type: 'int' })
  productionVersion!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
