import type { RegressionRun } from '../api/types';
import { useAuth } from '../../../auth/AuthContext';

/** Non-component helpers for the Typology Console screens (kept apart
 * from typologyShared.tsx so that file only exports components). */

// Every write in the console is MLRO-only; model_risk_audit reads.
const CAN_WRITE_ROLES = ['aml_detection.mlro_compliance_head'];

export function useCanWriteTypologies(): { canWrite: boolean; ready: boolean } {
  const { session } = useAuth();
  return { canWrite: !!session && CAN_WRITE_ROLES.some((r) => session.user.roleCodes.includes(r)), ready: !!session };
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export const isRunning = (run: RegressionRun | null | undefined) => run?.status === 'queued' || run?.status === 'running';

export const formatDate = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString() : '—');
