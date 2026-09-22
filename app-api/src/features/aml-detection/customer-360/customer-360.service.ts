import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface Customer360Account {
  accountId: string;
  caseIds: string[];
}

export interface Customer360PriorCase {
  caseId: string;
  typologyLabel: string | null;
  openedAt: string;
  closedAt: string | null;
  finalDisposition: string | null;
}

export interface Customer360ScreeningEntry {
  caseId: string;
  assembledAt: string;
  list_source: string;
  matched_name: string;
  match_confidence: number;
  match_rationale: string;
  disposition: string | null;
}

export interface Customer360Response {
  customerId: string;
  kyc: Record<string, unknown> | null;
  currentRiskScore: number | null;
  filingsCount: number;
  accounts: Customer360Account[];
  priorCases: Customer360PriorCase[];
  linkedEntities: Record<string, unknown>[];
  screeningHistory: Customer360ScreeningEntry[];
}

/** specs/suites/bfsi/features/aml-detection/screens/08-customer-360.md
 * Read-only aggregation across every aml_cases row for this customer_id
 * (a field on the embedded `alert` JSONB, per InboundAlert — there is no
 * standalone Customer table). No write methods on this service, per the
 * screen's acceptance criteria. */
@Injectable()
export class Customer360Service {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async getCustomer360(customerId: string): Promise<Customer360Response> {
    const cases = (await this.dataSource.query(
      `SELECT case_id, alert, created_at, closed_at
       FROM aml_cases
       WHERE alert ->> 'customer_id' = $1
       ORDER BY created_at DESC`,
      [customerId],
    )) as Array<{ case_id: string; alert: { account_ids?: string[] }; created_at: Date; closed_at: Date | null }>;

    if (cases.length === 0) {
      throw new NotFoundException(`No customer with customer_id=${customerId}`);
    }

    const caseIds = cases.map((c) => c.case_id);

    const [evidenceRows, typologyRows, assessmentRows, dispositionRows, filingCountRows] = await Promise.all([
      this.dataSource.query(
        `SELECT case_id, kyc, linked_entities, screening_results, assembled_at
         FROM aml_evidence_bundles WHERE case_id = ANY($1) ORDER BY assembled_at DESC`,
        [caseIds],
      ) as Promise<
        Array<{
          case_id: string;
          kyc: Record<string, unknown>;
          linked_entities: Record<string, unknown>[];
          screening_results: Record<string, unknown>[];
          assembled_at: Date;
        }>
      >,
      this.dataSource.query(`SELECT case_id, typology_label FROM aml_typology_matches WHERE case_id = ANY($1)`, [
        caseIds,
      ]) as Promise<Array<{ case_id: string; typology_label: string }>>,
      this.dataSource.query(
        `SELECT case_id, risk_score FROM aml_case_assessments WHERE case_id = ANY($1) ORDER BY assessed_at DESC`,
        [caseIds],
      ) as Promise<Array<{ case_id: string; risk_score: number }>>,
      this.dataSource.query(`SELECT case_id, disposition_type FROM aml_dispositions WHERE case_id = ANY($1)`, [
        caseIds,
      ]) as Promise<Array<{ case_id: string; disposition_type: string }>>,
      this.dataSource.query(`SELECT count(*)::int AS count FROM aml_str_filings WHERE case_id = ANY($1)`, [
        caseIds,
      ]) as Promise<Array<{ count: number }>>,
    ]);

    const typologyByCase = new Map(typologyRows.map((t) => [t.case_id, t.typology_label]));
    const dispositionByCase = new Map(dispositionRows.map((d) => [d.case_id, d.disposition_type]));

    // Accounts have no standalone entity (per phase-2-full-aml/
    // api-contracts-phase2.md's explicit scope decision) — derived from
    // the account_ids each case's alert already carries.
    const accountToCases = new Map<string, Set<string>>();
    for (const c of cases) {
      for (const accountId of c.alert.account_ids ?? []) {
        if (!accountToCases.has(accountId)) accountToCases.set(accountId, new Set());
        accountToCases.get(accountId)!.add(c.case_id);
      }
    }
    const accounts: Customer360Account[] = [...accountToCases.entries()].map(([accountId, caseIdSet]) => ({
      accountId,
      caseIds: [...caseIdSet],
    }));

    const priorCases: Customer360PriorCase[] = cases.map((c) => ({
      caseId: c.case_id,
      typologyLabel: typologyByCase.get(c.case_id) ?? null,
      openedAt: c.created_at.toISOString(),
      closedAt: c.closed_at ? c.closed_at.toISOString() : null,
      finalDisposition: dispositionByCase.get(c.case_id) ?? null,
    }));

    // Aggregated across all this customer's cases, deduped by
    // entity_id — the same person/account can legitimately surface in
    // more than one of the customer's evidence bundles.
    const linkedEntityById = new Map<string, Record<string, unknown>>();
    for (const e of evidenceRows) {
      for (const entity of e.linked_entities) {
        linkedEntityById.set(entity.entity_id as string, entity);
      }
    }

    const screeningHistory: Customer360ScreeningEntry[] = evidenceRows.flatMap((e) =>
      e.screening_results.map((s) => ({
        caseId: e.case_id,
        assembledAt: e.assembled_at.toISOString(),
        list_source: s.list_source as string,
        matched_name: s.matched_name as string,
        match_confidence: s.match_confidence as number,
        match_rationale: s.match_rationale as string,
        disposition: (s.disposition as string | null) ?? null,
      })),
    );

    // evidenceRows is ordered assembled_at DESC, so [0] is the latest
    // KYC snapshot across this customer's cases.
    const kyc = evidenceRows[0]?.kyc ?? null;
    const currentRiskScore = assessmentRows[0]?.risk_score ?? null;

    return {
      customerId,
      kyc,
      currentRiskScore,
      filingsCount: filingCountRows[0]?.count ?? 0,
      accounts,
      priorCases,
      linkedEntities: [...linkedEntityById.values()],
      screeningHistory,
    };
  }
}
