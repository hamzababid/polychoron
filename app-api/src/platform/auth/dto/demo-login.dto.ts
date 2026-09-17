import { IsString } from 'class-validator';

/** specs/suites/bfsi/features/aml-detection/phase-1-aml-core/api-contracts-phase1.md
 * "POST /api/v1/auth/demo-login → Body: {user_id}. Returns a
 * DemoSession. No password, no MFA — this is a seeded-user picker,
 * not real authentication." (constitution rule 9 — do not over-build) */
export class DemoLoginDto {
  @IsString()
  user_id!: string;
}
