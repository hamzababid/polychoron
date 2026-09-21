import { useParams } from 'react-router-dom';

/** Every screen under AmlDetectionRoutes needs an absolute path back to
 * its own feature root (e.g. for `navigate()` calls that cross between
 * sibling routes like alerts -> cases/:caseId, which relative paths
 * resolve incorrectly here — see AmlDetectionRoutes.tsx's own
 * <Routes> being a sibling, not ancestor, of its <nav>, which makes
 * React Router resolve "to" relative to the current full pathname
 * instead of the route's base, doubling segments like
 * /dashboard/dashboard). Deriving suiteCode/featureCode from the URL
 * instead of hardcoding "bfsi"/"aml_detection" also keeps this
 * feature-level component honest about not assuming its own mount
 * point. */
export function useFeatureBasePath(): string {
  const { suiteCode, featureCode } = useParams();
  return `/${suiteCode}/${featureCode}`;
}
