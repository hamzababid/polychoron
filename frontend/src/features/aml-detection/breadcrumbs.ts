export interface Crumb {
  label: string;
  to?: string;
}

/** Resolves the AML feature's own route segments into breadcrumb
 * labels — registered into shell/featureBreadcrumbs.ts the same way
 * AmlDetectionRoutes is registered into App.tsx's FEATURE_ELEMENTS.
 * `pathname` is the full URL path; `base` is this feature's own root
 * (`/:suiteCode/:featureCode`). */
export function getAmlBreadcrumbs(pathname: string, base: string): Crumb[] {
  const rel = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  const segments = rel.split('/').filter(Boolean);

  if (segments.length === 0 || segments[0] === 'dashboard') {
    return [{ label: 'Dashboard' }];
  }
  if (segments[0] === 'alerts') {
    return [{ label: 'Alert Queue' }];
  }
  if (segments[0] === 'filings') {
    return [{ label: 'goAML Tracker' }];
  }
  if (segments[0] === 'typologies') {
    return [{ label: 'Typology Console' }];
  }
  if (segments[0] === 'governance') {
    return [{ label: 'Model Governance' }];
  }
  if (segments[0] === 'reports') {
    return [{ label: 'Reporting' }];
  }
  if (segments[0] === 'customers' && segments[1]) {
    return [{ label: 'Customer 360' }];
  }
  if (segments[0] === 'cases' && segments[1]) {
    const caseId = segments[1];
    const shortId = caseId.slice(0, 8);
    const isFiling = segments[2] === 'filing';
    const crumbs: Crumb[] = [
      { label: 'Alert Queue', to: `${base}/alerts` },
      { label: `Case ${shortId}`, to: isFiling ? `${base}/cases/${caseId}` : undefined },
    ];
    if (isFiling) crumbs.push({ label: 'Filing Console' });
    return crumbs;
  }

  return [];
}
