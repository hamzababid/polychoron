// Mirrors app-api's PlatformController#listSuites response shape,
// which mirrors specs/platform/02-platform-data-models.py::Suite/Feature.

export interface FeatureSummary {
  featureCode: string;
  featureName: string;
  suiteCode: string;
  description: string;
  status: 'planned' | 'beta' | 'ga';
  roleManifestRef: string;
}

export interface SuiteWithFeatures {
  suiteCode: string;
  suiteName: string;
  description: string;
  features: FeatureSummary[];
}
