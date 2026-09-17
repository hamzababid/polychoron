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
    <nav className="feature-switcher" aria-label="Switch feature">
      {features.map((feature) => (
        <NavLink
          key={feature.featureCode}
          to={`/${suiteCode}/${feature.featureCode}`}
          className={({ isActive }) => `feature-switcher__tab${isActive ? ' feature-switcher__tab--active' : ''}`}
        >
          {feature.featureName}
          {feature.status !== 'ga' && <span className="feature-switcher__badge">{feature.status}</span>}
        </NavLink>
      ))}
    </nav>
  );
}
