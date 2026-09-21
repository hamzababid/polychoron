import { getAmlBreadcrumbs, type Crumb } from '../features/aml-detection/breadcrumbs';

export type { Crumb };

/** One resolver per feature, registered here the same way
 * App.tsx registers each feature's routed element — adding a second
 * feature means adding one entry, not teaching the shell about its
 * route structure. */
export const FEATURE_BREADCRUMB_RESOLVERS: Record<string, (pathname: string, base: string) => Crumb[]> = {
  aml_detection: getAmlBreadcrumbs,
};
