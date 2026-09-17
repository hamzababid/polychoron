import { useNavigate } from 'react-router-dom';
import type { SuiteWithFeatures } from './types';

interface Props {
  suites: SuiteWithFeatures[];
  activeSuiteCode: string;
}

/** Top-level suite switcher. Renders as a real switcher even with one
 * suite registered today (specs/platform/01-platform-architecture.md). */
export function SuiteSwitcher({ suites, activeSuiteCode }: Props) {
  const navigate = useNavigate();

  const handleChange = (suiteCode: string) => {
    const suite = suites.find((s) => s.suiteCode === suiteCode);
    const firstFeature = suite?.features[0];
    if (firstFeature) {
      navigate(`/${suiteCode}/${firstFeature.featureCode}`);
    }
  };

  return (
    <label className="suite-switcher">
      <span className="suite-switcher__label">Suite</span>
      <select
        className="suite-switcher__select"
        value={activeSuiteCode}
        onChange={(e) => handleChange(e.target.value)}
        aria-label="Switch suite"
      >
        {suites.map((suite) => (
          <option key={suite.suiteCode} value={suite.suiteCode}>
            {suite.suiteName}
          </option>
        ))}
      </select>
    </label>
  );
}
