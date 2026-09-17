import { useEffect, useState } from 'react';
import type { SuiteWithFeatures } from './types';

interface RegistryState {
  suites: SuiteWithFeatures[];
  loading: boolean;
  error: string | null;
}

/**
 * Backs the suite switcher / feature switcher
 * (specs/platform/01-platform-architecture.md, "Navigation shell").
 * Today this resolves to exactly one suite with one feature, but the
 * shell renders whatever the registry returns, so a second suite or
 * feature is a data change, not a UI rewrite.
 */
export function usePlatformRegistry(): RegistryState {
  const [state, setState] = useState<RegistryState>({ suites: [], loading: true, error: null });

  useEffect(() => {
    let cancelled = false;

    fetch('/api/v1/platform/suites')
      .then((res) => {
        if (!res.ok) throw new Error(`Platform registry request failed: ${res.status}`);
        return res.json() as Promise<SuiteWithFeatures[]>;
      })
      .then((suites) => {
        if (!cancelled) setState({ suites, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ suites: [], loading: false, error: err instanceof Error ? err.message : String(err) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
