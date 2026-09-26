import type { TypologyStatus } from '../api/types';

const LABELS: Record<TypologyStatus, string> = {
  live: 'LIVE',
  retired: 'RETIRED',
  not_live: 'NOT YET LIVE',
};

/** Kill-switched wins: it's what actually keeps a typology out of the
 * agent's catalog right now, whatever its promoted version says. */
export function TypologyStatusBadge({ status, killSwitched }: { status: TypologyStatus; killSwitched: boolean }) {
  if (killSwitched) return <span className="typology-status typology-status--killed">KILL-SWITCHED</span>;
  return <span className={`typology-status typology-status--${status}`}>{LABELS[status]}</span>;
}
