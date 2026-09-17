import type { ReactElement } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { NavigationShell } from './shell/NavigationShell';
import { usePlatformRegistry } from './shell/usePlatformRegistry';
import { AmlDetectionRoutes } from './features/aml-detection/AmlDetectionRoutes';
import { DemoLoginScreen } from './auth/DemoLoginScreen';
import { RequireAuth } from './auth/RequireAuth';

function RootRedirect() {
  const { suites, loading, error } = usePlatformRegistry();

  if (loading) return <div className="shell-status">Loading Polychoron AI…</div>;
  if (error) return <div className="shell-status shell-status--error">{error}</div>;

  const firstSuite = suites[0];
  const firstFeature = firstSuite?.features[0];
  if (!firstSuite || !firstFeature) {
    return <div className="shell-status shell-status--error">No suites/features are registered.</div>;
  }

  return <Navigate to={`/${firstSuite.suiteCode}/${firstFeature.featureCode}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<DemoLoginScreen />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <RootRedirect />
          </RequireAuth>
        }
      />
      <Route
        path="/:suiteCode/:featureCode/*"
        element={
          <RequireAuth>
            <NavigationShell />
          </RequireAuth>
        }
      >
        <Route path="*" element={<FeatureRouter />} />
      </Route>
    </Routes>
  );
}

const FEATURE_ELEMENTS: Record<string, ReactElement> = {
  aml_detection: <AmlDetectionRoutes />,
};

function FeatureRouter() {
  const { featureCode = '' } = useParams();
  return FEATURE_ELEMENTS[featureCode] ?? <div className="shell-status">Unknown feature: {featureCode}</div>;
}
