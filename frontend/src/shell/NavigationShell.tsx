import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { usePlatformRegistry } from './usePlatformRegistry';
import { SuiteSwitcher } from './SuiteSwitcher';
import { FeatureSwitcher } from './FeatureSwitcher';
import { useAuth } from '../auth/AuthContext';
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
  const { session, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

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

  const initials = session
    ? session.user.displayName
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '';
  const roleLabel = session?.user.roleCodes[0]?.split('.').pop()?.replace(/_/g, ' ') ?? '';

  return (
    <div className="shell">
      <div className="cmdbar">
        <span className="cmdbar__brand">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M12 1.6 20.6 6.6v10.8L12 22.4 3.4 17.4V6.6z" />
            <path d="M12 7.2 16.6 9.9v5.4L12 18l-4.6-2.7V9.9z" />
            <path d="M12 1.6v5.6M20.6 6.6l-4 3.3M20.6 17.4l-4-2.1M12 22.4V18M3.4 17.4l4-2.1M3.4 6.6l4 3.3" />
          </svg>
          POLYCHORON <small>AI</small>
        </span>
        <span className="cmdbar__rule" />
        <SuiteSwitcher suites={suites} activeSuiteCode={activeSuite.suiteCode} />
        <span className="cmdbar__rule" />
        <FeatureSwitcher suiteCode={activeSuite.suiteCode} features={activeSuite.features} />
        {session && (
          <div className="cmdbar__user">
            <span style={{ opacity: 0.7 }}>{session.user.displayName}</span>
            <span className="cmdbar__rule" />
            <span>{roleLabel}</span>
            <span className="cmdbar__avatar">{initials}</span>
            <button className="cmdbar__logout" onClick={handleLogout}>
              Log out
            </button>
          </div>
        )}
      </div>
      <main className="shell__content">
        <Outlet />
      </main>
    </div>
  );
}
