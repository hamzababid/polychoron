import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { AlertQueueScreen } from './alert-queue/AlertQueueScreen';
import { CaseWorkspaceScreen } from './case-workspace/CaseWorkspaceScreen';
import { FilingConsoleScreen } from './filing-console/FilingConsoleScreen';
import { GoamlTrackerScreen } from './goaml-tracker/GoamlTrackerScreen';
import { TypologyRulesConsoleScreen } from './typology-console/TypologyRulesConsoleScreen';
import { useAuth } from '../../auth/AuthContext';
import { useFeatureBasePath } from './useFeatureBasePath';
import './aml-theme.css';

const TYPOLOGY_CONSOLE_ROLES = ['aml_detection.mlro_compliance_head', 'platform.model_risk_audit'];

/** The AML Detection feature's own sub-navigation, below the platform
 * nav shell's suite/feature switcher. Phase 1's screens plus Phase 2's
 * Typology & Rules Console — Customer 360 / Screening Hub / Model
 * Governance / Reporting are still Phase 2 not-yet-built
 * (constitution rule 9, phase discipline). */
export function AmlDetectionRoutes() {
  const { session } = useAuth();
  const canSeeTypologyConsole = session ? TYPOLOGY_CONSOLE_ROLES.some((r) => session.user.roleCodes.includes(r)) : false;
  const base = useFeatureBasePath();

  return (
    <div className="aml-page">
      {/* Absolute paths, not relative ("dashboard") — this <nav> is a
          sibling of the <Routes> below, not a descendant of any of
          its <Route>s, so relative "to" values resolve against the
          current full pathname (React Router's route-context
          resolution) and double up segments, e.g. navigating from
          /dashboard to a relative "alerts" produces
          /dashboard/alerts instead of /alerts. */}
      <nav className="cmdbar aml-subnav">
        <NavLink to={`${base}/dashboard`} className={({ isActive }) => (isActive ? 'active' : undefined)}>
          Dashboard
        </NavLink>
        <NavLink to={`${base}/alerts`} className={({ isActive }) => (isActive ? 'active' : undefined)}>
          Alert Queue
        </NavLink>
        <NavLink to={`${base}/filings`} className={({ isActive }) => (isActive ? 'active' : undefined)}>
          goAML Tracker
        </NavLink>
        {canSeeTypologyConsole && (
          <NavLink to={`${base}/typologies`} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Typology Console
          </NavLink>
        )}
      </nav>
      <div className="aml-page__body">
        <Routes>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardScreen />} />
          <Route path="alerts" element={<AlertQueueScreen />} />
          <Route path="cases/:caseId" element={<CaseWorkspaceScreen />} />
          <Route path="cases/:caseId/filing" element={<FilingConsoleScreen />} />
          <Route path="filings" element={<GoamlTrackerScreen />} />
          <Route path="typologies" element={<TypologyRulesConsoleScreen />} />
        </Routes>
      </div>
    </div>
  );
}
