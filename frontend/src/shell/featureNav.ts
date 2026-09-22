/** Screen-level nav items per feature, rendered as a group in the
 * sidebar under that feature's real featureName (from the platform
 * registry — never duplicated here as a literal string). This is the
 * sidebar's analogue of App.tsx's FEATURE_ELEMENTS map: one small,
 * explicit registration point per feature rather than the platform
 * shell hardcoding a specific feature's screens inline. Adding a
 * second feature means adding one entry here, not editing how the
 * sidebar itself works. */
export interface FeatureNavItem {
  label: string;
  /** Path segment appended to the feature's base route, e.g. "dashboard". */
  path: string;
  /** If set, only shown when the session has one of these role codes. */
  roles?: string[];
}

export const FEATURE_NAV_ITEMS: Record<string, FeatureNavItem[]> = {
  aml_detection: [
    { label: 'Dashboard', path: 'dashboard' },
    { label: 'Alert Queue', path: 'alerts' },
    { label: 'goAML Tracker', path: 'filings', roles: ['aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head'] },
    { label: 'Typology Console', path: 'typologies', roles: ['aml_detection.mlro_compliance_head', 'platform.model_risk_audit'] },
    {
      label: 'Model Governance',
      path: 'governance',
      roles: ['aml_detection.mlro_compliance_head', 'platform.model_risk_audit', 'platform.external_examiner'],
    },
    { label: 'Reporting', path: 'reports', roles: ['aml_detection.mlro_compliance_head'] },
  ],
};
