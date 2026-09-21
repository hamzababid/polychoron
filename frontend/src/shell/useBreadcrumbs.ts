import { useLocation, useParams } from 'react-router-dom';
import { usePlatformRegistry } from './usePlatformRegistry';
import { FEATURE_BREADCRUMB_RESOLVERS, type Crumb } from './featureBreadcrumbs';

export type { Crumb };

/** Suite name + feature name (from the real platform registry, never
 * hardcoded) followed by whatever the active feature's own resolver
 * says about the rest of the path. */
export function useBreadcrumbs(): Crumb[] {
  const { suiteCode = '', featureCode = '' } = useParams();
  const location = useLocation();
  const { suites } = usePlatformRegistry();

  const suite = suites.find((s) => s.suiteCode === suiteCode);
  const feature = suite?.features.find((f) => f.featureCode === featureCode);
  const base = `/${suiteCode}/${featureCode}`;

  const crumbs: Crumb[] = [];
  if (suite) crumbs.push({ label: suite.suiteName });
  if (feature) crumbs.push({ label: feature.featureName, to: `${base}/dashboard` });

  const resolver = FEATURE_BREADCRUMB_RESOLVERS[featureCode];
  if (resolver) crumbs.push(...resolver(location.pathname, base));

  return crumbs;
}
