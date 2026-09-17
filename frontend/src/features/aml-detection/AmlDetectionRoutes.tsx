import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { AlertQueueScreen } from './alert-queue/AlertQueueScreen';
import { CaseWorkspaceScreen } from './case-workspace/CaseWorkspaceScreen';
import { FilingConsoleScreen } from './filing-console/FilingConsoleScreen';
import { GoamlTrackerScreen } from './goaml-tracker/GoamlTrackerScreen';
import { TypologyRulesConsoleScreen } from './typology-console/TypologyRulesConsoleScreen';
import { useAuth } from '../../auth/AuthContext';
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

  return (
    <div className="aml-page">
      <nav className="aml-subnav">
        <NavLink to="dashboard" className={({ isActive }) => (isActive ? 'active' : undefined)}>
          Dashboard
        </NavLink>
        <NavLink to="alerts" className={({ isActive }) => (isActive ? 'active' : undefined)}>
          Alert Queue
        </NavLink>
        <NavLink to="filings" className={({ isActive }) => (isActive ? 'active' : undefined)}>
          goAML Tracker
        </NavLink>
        {canSeeTypologyConsole && (
          <NavLink to="typologies" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            Typology Console
          </NavLink>
        )}
      </nav>
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
  );
}
