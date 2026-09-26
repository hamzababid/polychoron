/**
 * Migrates Phase 1's hardcoded typology catalog
 * (agent-service/app/features/aml_detection/typology_catalog.py) into
 * real, versioned aml_typology_configs rows — the swap Phase 1
 * explicitly anticipated. Run once when standing up Phase 2's
 * Typology Console; safe to re-run (idempotent on typology_code).
 *
 * Usage (after `npm run build`): node dist/scripts/seed-typology-configs.js
 */
import { NestFactory } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { AppModule } from '../app.module.js';

const SEEDED_BY_USER_ID = 'demo-mlro-1';

// Mirrors agent-service/app/features/aml_detection/typology_catalog.py's
// DEMO_CASH_REPORTING_THRESHOLD_PKR-based descriptions exactly, so
// the Pattern Matching Agent's prompt context doesn't change when it
// switches from reading the hardcoded module to reading this table.
const CATALOG = [
  {
    typologyCode: 'structuring_subthreshold',
    typologyLabel: 'Structuring — sub-threshold cash deposits',
    ruleLogicDescription:
      'Multiple cash deposits, each individually below the PKR 2,000,000 cash reporting threshold, ' +
      'clustered tightly in time (within hours of each other, same day) and/or split across branches — ' +
      'a pattern consistent with deliberately avoiding a single reportable transaction — where the ' +
      "aggregate amount substantially exceeds what the customer's declared occupation/turnover would explain.",
  },
  {
    typologyCode: 'deposit_velocity_shift',
    typologyLabel: 'Deposit velocity shift — unexplained increase in cash activity',
    ruleLogicDescription:
      'A gradual step-change increase in cash deposit frequency or volume over days to weeks (not same-day ' +
      "clustering, and not obviously threshold-avoidant), relative to the customer's prior pattern, which may " +
      'have an innocuous business explanation (e.g. seasonal stocking) but warrants human judgment rather than ' +
      'an automatic clear.',
  },
];

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const dataSource = app.get<DataSource>(getConnectionToken());

    // The baseline catalog predates the governed lifecycle (migration
    // 014): it is written straight in as promoted v1 under the explicit
    // maintenance override, the same way the migration's backfill
    // treats it. Idempotent, and never overwrites a typology that
    // already exists — once seeded, content only changes through a
    // regression-gated promotion in the console.
    let seeded = 0;
    await dataSource.transaction(async (tx) => {
      await tx.query(`SET LOCAL polychoron.typology_maintenance = 'on'`);
      for (const t of CATALOG) {
        const inserted = (await tx.query(
          `INSERT INTO aml_typology_configs (typology_code, created_by) VALUES ($1, $2)
           ON CONFLICT (typology_code) DO NOTHING RETURNING typology_code`,
          [t.typologyCode, SEEDED_BY_USER_ID],
        )) as unknown[];
        if (inserted.length === 0) continue;
        await tx.query(
          `INSERT INTO aml_typology_config_versions
             (typology_code, version, typology_label, rule_logic_description, active, status, changed_by, change_reason)
           VALUES ($1, 1, $2, $3, true, 'promoted', $4, 'Initial migration from Phase 1 hardcoded catalog')`,
          [t.typologyCode, t.typologyLabel, t.ruleLogicDescription, SEEDED_BY_USER_ID],
        );
        await tx.query(`UPDATE aml_typology_configs SET production_version = 1 WHERE typology_code = $1`, [t.typologyCode]);
        seeded++;
      }
    });

    console.log(`Seeded ${seeded} of ${CATALOG.length} typology configs (promoted v1); existing ones left untouched.`);
  } finally {
    await app.close();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
