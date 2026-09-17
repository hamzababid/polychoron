/**
 * Seeds the platform_roles catalog entries from
 * suites/bfsi/features/aml-detection/role-manifest.md and the 2 Phase 1
 * demo users, mapped per that manifest's "DemoRole -> real role"
 * note: DemoRole.ANALYST -> aml_detection.analyst_l1,
 * DemoRole.COMPLIANCE_OFFICER -> aml_detection.senior_officer_l2.
 * PlatformUser/PlatformRole are owned (writes) by app-api per
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
