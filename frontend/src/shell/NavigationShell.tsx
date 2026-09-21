import { useState } from 'react';
import { NavLink, Outlet, useNavigate, useParams } from 'react-router-dom';
import { usePlatformRegistry } from './usePlatformRegistry';
import { FEATURE_NAV_ITEMS } from './featureNav';
import { TopHeader } from './TopHeader';
import { PageHeader } from './PageHeader';
import { useAuth } from '../auth/AuthContext';
import './shell.css';

const COLLAPSE_STORAGE_KEY = 'polychoron.sidenavCollapsed';

/**
 * The platform-level navigation shell every suite and feature renders
 * inside — a collapsible left sidebar with the suite switcher at top
 * and one nav group per registered feature (specs/platform/
 * 01-platform-architecture.md, "Navigation shell") — still visibly
 * present even with one suite and one feature registered today.
 */
export function NavigationShell() {
  const { suiteCode = '' } = useParams();
  const { suites, loading, error } = usePlatformRegistry();
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  };

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

  const handleSuiteChange = (nextSuiteCode: string) => {
    const suite = suites.find((s) => s.suiteCode === nextSuiteCode);
    const firstFeature = suite?.features[0];
    if (firstFeature) navigate(`/${nextSuiteCode}/${firstFeature.featureCode}`);
  };

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
    <div className={`shell${collapsed ? ' shell--collapsed' : ''}`}>
      <aside className="sidenav">
        <div className="sidenav__brand">
          <span className="sidenav__brandMark">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.2">
              <path d="M12 1.6 20.6 6.6v10.8L12 22.4 3.4 17.4V6.6z" />
              <path d="M12 7.2 16.6 9.9v5.4L12 18l-4.6-2.7V9.9z" />
              <path d="M12 1.6v5.6M20.6 6.6l-4 3.3M20.6 17.4l-4-2.1M12 22.4V18M3.4 17.4l4-2.1M3.4 6.6l4 3.3" />
            </svg>
          </span>
          {!collapsed && (
            <span className="sidenav__brandText">
              POLYCHORON <small>AI</small>
            </span>
          )}
          <button className="sidenav__collapseBtn" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'} title={collapsed ? 'Expand' : 'Collapse'}>
            {collapsed ? '»' : '«'}
          </button>
        </div>

        <div className="sidenav__suite">
          <select
            className="sidenav__suiteSelect"
            value={activeSuite.suiteCode}
            onChange={(e) => handleSuiteChange(e.target.value)}
            aria-label="Switch suite"
          >
            {suites.map((suite) => (
              <option key={suite.suiteCode} value={suite.suiteCode}>
                {collapsed ? suite.suiteCode.toUpperCase() : suite.suiteName}
              </option>
            ))}
          </select>
        </div>

        <nav className="sidenav__scroll">
          {activeSuite.features.map((feature) => {
            const items = (FEATURE_NAV_ITEMS[feature.featureCode] ?? []).filter(
              (item) => !item.roles || (session && item.roles.some((r) => session.user.roleCodes.includes(r))),
            );
            const base = `/${activeSuite.suiteCode}/${feature.featureCode}`;
            return (
              <div className="sidenav__group" key={feature.featureCode}>
                {!collapsed && (
                  <div className="sidenav__groupLabel">
                    {feature.featureName}
                    {feature.status !== 'ga' && <span className="tag tag-outline sidenav__groupBadge">{feature.status}</span>}
                  </div>
                )}
                {items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={`${base}/${item.path}`}
                    className={({ isActive }) => `sidenav__link${isActive ? ' active' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <span className="sidenav__linkDot">{item.label[0]}</span>
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        {session && (
          <div className="sidenav__footer">
            <span className="sidenav__avatar">{initials}</span>
            {!collapsed && (
              <div className="sidenav__who">
                <div className="sidenav__whoName">{session.user.displayName}</div>
                <div className="sidenav__whoRole">{roleLabel}</div>
              </div>
            )}
            <button className="sidenav__logout" onClick={handleLogout} title="Log out">
              {collapsed ? '⏻' : 'Log out'}
            </button>
          </div>
        )}
      </aside>
      <main className="shell__content">
        <TopHeader />
        <PageHeader />
        <Outlet />
      </main>
    </div>
  );
}
