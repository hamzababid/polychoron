import { NavLink } from 'react-router-dom';
import type { FeatureSummary } from './types';

interface Props {
  suiteCode: string;
  features: FeatureSummary[];
}

/** Feature switcher within the active suite. Renders as a real
 * switcher even with one feature registered today
 * (specs/platform/01-platform-architecture.md). */
export function FeatureSwitcher({ suiteCode, features }: Props) {
  return (
    <nav className="cmdbar__nav" aria-label="Switch feature" style={{ flex: 'none' }}>
      {features.map((feature) => (
        <NavLink
          key={feature.featureCode}
          to={`/${suiteCode}/${feature.featureCode}`}
          className={({ isActive }) => (isActive ? 'active' : undefined)}
        >
          {feature.featureName}
          {feature.status !== 'ga' && <span className="tag tag-outline" style={{ marginLeft: 6, fontSize: 9 }}>{feature.status}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
