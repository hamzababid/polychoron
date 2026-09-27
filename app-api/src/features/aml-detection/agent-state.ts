/** What the agent chain has (or hasn't) produced for a case — shown in
 * Alert Queue and Case Workspace instead of treating "no risk score
 * yet" as "processing", which left two kinds of case looking stuck:
 * cases the agent never ran on (a record closed before AML Detection
 * existed, e.g. the seeded TMS-ALERT-DEMO-A-PRIOR) and cases whose
 * workflow failed partway. Derived in SQL so the queue, global search
 * and case detail can't disagree.
 *
 * - assessed:    Case & Narrative's assessment exists
 * - kill_switch: the feature kill switch routed it to manual review (G6)
 * - not_run:     closed, and the agent never ran on it (no activity log)
 * - processing:  agent activity (or the case itself) within the window
 * - stalled:     the agent started but never finished — review manually
 */
export type AgentState = 'assessed' | 'kill_switch' | 'not_run' | 'processing' | 'stalled';

// A healthy run takes seconds; a case with no progress for this long
// isn't going to finish on its own.
export const STALLED_AFTER_MINUTES = 15;

/** `c`, `a`, `e`: aliases for aml_cases, aml_case_assessments,
 * aml_evidence_bundles (the latter two LEFT JOINed). */
export function agentStateSql(c = 'c', a = 'a', e = 'e'): string {
  const lastActivity = `(SELECT max(l."timestamp") FROM platform_agent_activity_log l
                          WHERE l.feature_code = 'aml_detection' AND l.external_case_ref = ${c}.case_id::text)`;
  return `CASE
    WHEN ${a}.case_id IS NOT NULL THEN 'assessed'
    WHEN ${e}.kill_switch_active THEN 'kill_switch'
    WHEN ${lastActivity} IS NULL AND ${c}.status IN ('cleared', 'filed') THEN 'not_run'
    WHEN greatest(${c}.created_at, ${lastActivity}) > now() - interval '${STALLED_AFTER_MINUTES} minutes' THEN 'processing'
    ELSE 'stalled'
  END`;
}
