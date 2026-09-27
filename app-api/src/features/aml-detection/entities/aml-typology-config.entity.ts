import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** specs/suites/bfsi/features/aml-detection/screens/06-typology-rules-console.md
 * Identity only since migration 014 — everything the Pattern Matching
 * Agent sees lives on the version at `productionVersion` (null: never
 * promoted, so not in the agent's catalog). Owned (writes) by app-api;
 * agent-service reads it. */
@Entity({ name: 'aml_typology_configs' })
export class AmlTypologyConfig {
  @PrimaryColumn({ name: 'typology_code' })
  typologyCode!: string;

  @Column({ name: 'production_version', type: 'int', nullable: true })
  productionVersion!: number | null;

  @Column({ name: 'created_by' })
  createdBy!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
