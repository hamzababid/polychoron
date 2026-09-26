import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** A named, reusable chunking configuration
 * (specs/platform/10-regulatory-knowledge-base-spec.md, "Phase 2
 * addendum"). READ-ONLY from app-api — created through the
 * RegulatoryDraftCommand's `create_profile` op. */
@Entity({ name: 'regulatory_chunking_profiles' })
export class RegulatoryChunkingProfile {
  @PrimaryGeneratedColumn('uuid', { name: 'profile_id' })
  profileId!: string;

  @Column({ name: 'feature_code' })
  featureCode!: string;

  @Column()
  name!: string;

  @Column({ type: 'jsonb' })
  config!: Record<string, unknown>;

  @Column({ name: 'created_by' })
  createdBy!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
