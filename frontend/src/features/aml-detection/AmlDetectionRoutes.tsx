import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { AlertQueueScreen } from './alert-queue/AlertQueueScreen';
import { CaseWorkspaceScreen } from './case-workspace/CaseWorkspaceScreen';
import { FilingConsoleScreen } from './filing-console/FilingConsoleScreen';
import { GoamlTrackerScreen } from './goaml-tracker/GoamlTrackerScreen';
import { TypologyRulesConsoleScreen } from './typology-console/TypologyRulesConsoleScreen';
import './aml-theme.css';

/** The AML Detection feature's routed screens. Its own top-level
 * screen nav lives in the platform shell's sidebar now (see
 * ../../shell/featureNav.ts's "aml_detection" entry + NavigationShell)
 * — Case Workspace and Filing Console stay drill-down-only routes,
 * reached by clicking a case rather than a sidebar link. Customer 360
 * / Screening Hub / Model Governance / Reporting are still Phase 2
 * not-yet-built (constitution rule 9, phase discipline). */
export function AmlDetectionRoutes() {
  return (
    <div className="aml-page">
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
