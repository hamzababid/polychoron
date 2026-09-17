export type RiskTierFilter = 'critical' | 'high' | 'medium' | 'low';

// Phase 1 simplification: SLA targets are by risk-score band, not by
// individual typology config — see alert-queue.service.ts's note.
export const SLA_HOURS_BY_TIER: Record<RiskTierFilter, number> = {
  critical: 24,
  high: 48,
  medium: 96,
  low: 168,
};

export const RISK_TIER_RANGES: Record<RiskTierFilter, { min: number; max: number | null }> = {
  critical: { min: 80, max: null },
  high: { min: 50, max: 79 },
  medium: { min: 25, max: 49 },
  low: { min: 0, max: 24 },
};

export function riskTierForScore(score: number | null): RiskTierFilter | null {
  if (score === null) return null;
  if (score >= 80) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}
