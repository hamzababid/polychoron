import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { AlertQueueScreen } from './alert-queue/AlertQueueScreen';
import { CaseWorkspaceScreen } from './case-workspace/CaseWorkspaceScreen';
import { FilingConsoleScreen } from './filing-console/FilingConsoleScreen';
import { GoamlTrackerScreen } from './goaml-tracker/GoamlTrackerScreen';
import './aml-theme.css';

/** The AML Detection feature's own sub-navigation, below the platform
 * nav shell's suite/feature switcher. Only Phase 1's screens are
 * linked here — Customer 360 / Screening Hub / Typology Console /
 * Model Governance / Reporting are Phase 2, not built yet
 * (constitution rule 9, phase discipline). */
export function AmlDetectionRoutes() {
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
      </nav>
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardScreen />} />
        <Route path="alerts" element={<AlertQueueScreen />} />
        <Route path="cases/:caseId" element={<CaseWorkspaceScreen />} />
        <Route path="cases/:caseId/filing" element={<FilingConsoleScreen />} />
        <Route path="filings" element={<GoamlTrackerScreen />} />
      </Routes>
    </div>
  );
}
