import { Navigate, Route, Routes } from 'react-router-dom';
import { DashboardScreen } from './dashboard/DashboardScreen';
import { AlertQueueScreen } from './alert-queue/AlertQueueScreen';
import { CaseWorkspaceScreen } from './case-workspace/CaseWorkspaceScreen';
import { FilingConsoleScreen } from './filing-console/FilingConsoleScreen';
import { GoamlTrackerScreen } from './goaml-tracker/GoamlTrackerScreen';
import { TypologyRulesConsoleScreen } from './typology-console/TypologyRulesConsoleScreen';
import { Customer360Screen } from './customer-360/Customer360Screen';
import { ModelGovernanceScreen } from './model-governance/ModelGovernanceScreen';
import { ReportingScreen } from './reporting/ReportingScreen';
import './aml-theme.css';

/** The AML Detection feature's routed screens. Its own top-level
 * screen nav lives in the platform shell's sidebar now (see
 * ../../shell/featureNav.ts's "aml_detection" entry + NavigationShell)
 * — Case Workspace, Filing Console, and Customer 360 stay
 * drill-down-only routes, reached by clicking through from Alert
 * Queue/Case Workspace rather than a sidebar link. Model Governance
 * and Reporting have their own sidebar entries (role-gated) since
 * they're not reached by drilling into a case. Screening Hub is still
 * Phase 2 not-yet-built (constitution rule 9, phase discipline). */
export function AmlDetectionRoutes() {
  return (
    <div className="aml-page">
      <Routes>
        <Route index element={<Navigate to="dashboard" replace />} />
        <Route path="dashboard" element={<DashboardScreen />} />
        <Route path="alerts" element={<AlertQueueScreen />} />
        <Route path="cases/:caseId" element={<CaseWorkspaceScreen />} />
        <Route path="cases/:caseId/filing" element={<FilingConsoleScreen />} />
        <Route path="customers/:customerId" element={<Customer360Screen />} />
        <Route path="filings" element={<GoamlTrackerScreen />} />
        <Route path="typologies" element={<TypologyRulesConsoleScreen />} />
        <Route path="governance" element={<ModelGovernanceScreen />} />
        <Route path="reports" element={<ReportingScreen />} />
      </Routes>
    </div>
  );
}
