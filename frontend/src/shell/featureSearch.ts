import { searchCases } from '../features/aml-detection/api/client';

export interface SearchResult {
  id: string;
  title: string;
  subtitle: string;
  href: (base: string) => string;
}

export interface FeatureSearchConfig {
  placeholder: string;
  search: (q: string) => Promise<SearchResult[]>;
}

/** One search adapter per feature, registered here the same way
 * shell/featureNav.ts registers each feature's screen nav — the
 * header calls whichever adapter matches the active featureCode,
 * so it never needs to know a specific feature's data shape. */
export const FEATURE_SEARCH: Record<string, FeatureSearchConfig> = {
  aml_detection: {
    placeholder: 'Search customer, alert ID, CNIC…',
    search: async (q) => {
      const rows = await searchCases(q);
      return rows.map((r) => ({
        id: r.caseId,
        title: r.customerName ?? r.customerId,
        subtitle: `${r.sourceAlertId} · ${r.status.replace('_', ' ')}${r.riskScore !== null ? ` · risk ${r.riskScore}` : ''}`,
        href: (base: string) => `${base}/cases/${r.caseId}`,
      }));
    },
  },
};
