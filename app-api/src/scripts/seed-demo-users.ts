/**
 * Seeds the platform_roles catalog (feature-level AML roles from
 * role-manifest.md, plus the platform-level roles from
 * 05-rbac-platform-spec.md that Phase 2's Typology Console / Model
 * Governance screens gate on) and one demo user per role — the same
 * Phase 1 demo-login stub extended, not a second auth mechanism, per
 * the explicit Phase 2 scope decision in
 * phase-2-full-aml/api-contracts-phase2.md. PlatformUser/PlatformRole
 * are owned (writes) by app-api per
 * specs/platform/09-backend-service-boundary-spec.md. Idempotent.
 *
 * Usage (after `npm run build`): node dist/scripts/seed-demo-users.js
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { AppModule } from '../app.module.js';
import { PlatformRole, PlatformUser } from '../platform/entities/index.js';

const DEMO_TENANT_ID = 'demo-northbridge-bank';

const ROLES: Partial<PlatformRole>[] = [
  {
    roleCode: 'aml_detection.analyst_l1',
    featureCode: 'aml_detection',
    displayName: 'AML Analyst',
    description: 'Alert Queue, Case Workspace, Customer 360 — claim_alert, add_case_note, record_disposition (up to enhanced_monitoring/escalate_senior)',
  },
  {
    roleCode: 'aml_detection.senior_officer_l2',
    featureCode: 'aml_detection',
    displayName: 'AML Senior Compliance Officer',
    description: 'Analyst permissions + Filing Console — file_str, file_ctr, attest_filing, submit_filing',
  },
  {
    roleCode: 'aml_detection.mlro_compliance_head',
    featureCode: 'aml_detection',
    displayName: 'MLRO / Compliance Head',
    description: 'All AML screens + promote_typology_rule, export_report, view_dashboard',
  },
  {
    roleCode: 'platform.model_risk_audit',
    displayName: 'Model Risk & Audit',
    description: 'Read-only, cross-feature: Agent Activity Log and Model Governance & Audit views. Cannot see live case content unless part of a sampling review pool.',
  },
  {
    roleCode: 'platform.external_examiner',
    displayName: 'External Examiner',
    description: 'Time-boxed, read-only, cross-feature (Phase 1/2 demo stub: not actually time-boxed — real auto-expiring credentials are Phase 3 scope).',
  },
];

const USERS: Partial<PlatformUser>[] = [
  {
    userId: 'demo-analyst-1',
    tenantId: DEMO_TENANT_ID,
    displayName: 'Amina Raza (Demo Analyst)',
    email: 'demo-analyst@example.test',
    roleCodes: ['aml_detection.analyst_l1'],
  },
  {
    userId: 'demo-compliance-officer-1',
    tenantId: DEMO_TENANT_ID,
    displayName: 'Bilal Siddiqui (Demo Compliance Officer)',
    email: 'demo-compliance-officer@example.test',
    roleCodes: ['aml_detection.senior_officer_l2'],
  },
  {
    userId: 'demo-mlro-1',
    tenantId: DEMO_TENANT_ID,
    displayName: 'Fatima Noor (Demo MLRO)',
    email: 'demo-mlro@example.test',
    roleCodes: ['aml_detection.mlro_compliance_head'],
  },
  {
    userId: 'demo-model-risk-audit-1',
    tenantId: DEMO_TENANT_ID,
    displayName: 'Usman Ali (Demo Model Risk & Audit)',
    email: 'demo-model-risk-audit@example.test',
    roleCodes: ['platform.model_risk_audit'],
  },
  {
    userId: 'demo-external-examiner-1',
    tenantId: DEMO_TENANT_ID,
    displayName: 'Sana Iqbal (Demo External Examiner)',
    email: 'demo-external-examiner@example.test',
    roleCodes: ['platform.external_examiner'],
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const roleRepo = app.get<Repository<PlatformRole>>(getRepositoryToken(PlatformRole));
    const userRepo = app.get<Repository<PlatformUser>>(getRepositoryToken(PlatformUser));

    await roleRepo.upsert(ROLES, ['roleCode']);
    await userRepo.upsert(USERS, ['userId']);

    console.log(`Seeded ${ROLES.length} platform roles and ${USERS.length} demo users.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
