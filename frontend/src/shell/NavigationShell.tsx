import { Outlet, useParams } from 'react-router-dom';
import { usePlatformRegistry } from './usePlatformRegistry';
import { SuiteSwitcher } from './SuiteSwitcher';
import { FeatureSwitcher } from './FeatureSwitcher';
import './shell.css';

/**
 * The platform-level navigation shell every suite and feature renders
 * inside — the suite switcher plus the feature switcher for whichever
 * suite is active (specs/platform/01-platform-architecture.md,
 * "Navigation shell").
 */
export function NavigationShell() {
  const { suiteCode = '' } = useParams();
  const { suites, loading, error } = usePlatformRegistry();

  if (loading) {
    return <div className="shell-status">Loading Polychoron AI…</div>;
  }
  if (error) {
    return <div className="shell-status shell-status--error">Could not load the platform registry: {error}</div>;
  }

  const activeSuite = suites.find((s) => s.suiteCode === suiteCode) ?? suites[0];
  if (!activeSuite) {
    return <div className="shell-status shell-status--error">No suites are registered for this platform.</div>;
  }

  return (
    <div className="shell">
      <header className="shell__topbar">
        <span className="shell__brand">Polychoron AI</span>
        <SuiteSwitcher suites={suites} activeSuiteCode={activeSuite.suiteCode} />
      </header>
      <div className="shell__subbar">
        <FeatureSwitcher suiteCode={activeSuite.suiteCode} features={activeSuite.features} />
      </div>
      <main className="shell__content">
        <Outlet />
      </main>
    </div>
  );
}
