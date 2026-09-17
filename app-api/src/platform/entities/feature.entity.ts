import { Column, Entity, PrimaryColumn } from 'typeorm';

export enum FeatureStatus {
  PLANNED = 'planned',
  BETA = 'beta',
  GA = 'ga',
}

/** specs/platform/02-platform-data-models.py::Feature */
@Entity({ name: 'features' })
export class Feature {
  @PrimaryColumn({ name: 'feature_code' })
  featureCode!: string;

  @Column({ name: 'feature_name' })
  featureName!: string;

  @Column({ name: 'suite_code' })
  suiteCode!: string;

  @Column()
  description!: string;

  @Column({ type: 'text' })
  status!: FeatureStatus;

  @Column({ name: 'role_manifest_ref' })
  roleManifestRef!: string;
}
