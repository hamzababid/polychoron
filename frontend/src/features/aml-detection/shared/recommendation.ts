/** Display label for an agent recommendation code — "recommend_str" →
 * "Recommend STR" (a plain underscore-to-space loses the acronym). */
const LABELS: Record<string, string> = {
  recommend_str: 'Recommend STR',
  recommend_ctr: 'Recommend CTR',
  escalate: 'Escalate',
  clear: 'Clear',
};

export const recommendationLabel = (code: string) => LABELS[code] ?? code.replace(/_/g, ' ');
