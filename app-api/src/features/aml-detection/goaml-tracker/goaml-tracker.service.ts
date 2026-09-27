import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AmlFmuFollowup } from '../entities/aml-fmu-followup.entity.js';
import { AmlStrFiling, FilingSubmissionStatus } from '../entities/aml-str-filing.entity.js';

// specs/suites/bfsi/features/aml-detection/screens/05-goaml-tracker.md:
// "confirm exact policy window with compliance before hardcoding" —
// this default is a Phase 1 placeholder, not a confirmed compliance
// policy value.
const RETENTION_REVIEW_WINDOW_DAYS = 90;

export interface FilingSummary {
  filingId: string;
  caseId: string;
  reportType: string;
  submissionStatus: FilingSubmissionStatus;
  goamlReference: string | null;
  submittedAt: string | null;
  acknowledgedAt: string | null;
  feedbackReceivedAt: string | null;
  retentionExpiry: string | null;
  retentionReviewDue: boolean;
}

export interface FilingDetail extends FilingSummary {
  payload: Record<string, unknown>;
  finalNarrative: string;
  followups: Array<{ followupId: string; note: string; createdBy: string; createdAt: string }>;
}

export interface FilingPortfolioCounts {
  total: number;
  awaiting: number;
  acknowledged: number;
  retentionDue: number;
}

@Injectable()
export class GoamlTrackerService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlStrFiling) private readonly filings: Repository<AmlStrFiling>,
    @InjectRepository(AmlFmuFollowup) private readonly followups: Repository<AmlFmuFollowup>,
  ) {}

  async list(page: number, pageSize: number): Promise<{ items: FilingSummary[]; total: number; counts: FilingPortfolioCounts }> {
    const [[rows, total], counts] = await Promise.all([
      this.filings.findAndCount({
        order: { submittedAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.portfolioCounts(),
    ]);
    return { items: rows.map((f) => this.toSummary(f)), total, counts };
  }

  /** The portfolio strip's numbers, across every filing — not just the
   * page being shown (they used to be counted client-side from the
   * first 50 rows). Same retention window as toSummary(). */
  private async portfolioCounts(): Promise<FilingPortfolioCounts> {
    const [row] = (await this.dataSource.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE submission_status = 'submitted')::int AS awaiting,
              count(*) FILTER (WHERE submission_status IN ('acknowledged', 'feedback_received'))::int AS acknowledged,
              count(*) FILTER (WHERE retention_expiry IS NOT NULL
                                 AND retention_expiry <= now() + make_interval(days => $1))::int AS retention_due
       FROM aml_str_filings`,
      [RETENTION_REVIEW_WINDOW_DAYS],
    )) as Array<{ total: number; awaiting: number; acknowledged: number; retention_due: number }>;
    return { total: row.total, awaiting: row.awaiting, acknowledged: row.acknowledged, retentionDue: row.retention_due };
  }

  async getDetail(filingId: string): Promise<FilingDetail> {
    const filing = await this.filings.findOneBy({ filingId });
    if (!filing) {
      throw new NotFoundException(`No filing with filing_id=${filingId}`);
    }
    const followupRows = await this.followups.find({ where: { filingId }, order: { createdAt: 'ASC' } });

    return {
      ...this.toSummary(filing),
      payload: filing.payload,
      finalNarrative: filing.finalNarrative,
      followups: followupRows.map((f) => ({
        followupId: f.followupId,
        note: f.note,
        createdBy: f.createdBy,
        createdAt: f.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Demo-only endpoint (api-contracts-phase1.md) — manually advances
   * status for the live demo; does not exist once there's a real
   * FMU/goAML connection (Phase 3).
   */
  async simulateAcknowledgment(filingId: string): Promise<FilingSummary> {
    const filing = await this.filings.findOneBy({ filingId });
    if (!filing) {
      throw new NotFoundException(`No filing with filing_id=${filingId}`);
    }
    if (filing.submissionStatus !== FilingSubmissionStatus.SUBMITTED) {
      throw new BadRequestException(`Filing ${filingId} is ${filing.submissionStatus}, not SUBMITTED — cannot acknowledge`);
    }

    const acknowledgedAt = new Date();
    await this.filings.update({ filingId }, { submissionStatus: FilingSubmissionStatus.ACKNOWLEDGED, acknowledgedAt });
    filing.submissionStatus = FilingSubmissionStatus.ACKNOWLEDGED;
    filing.acknowledgedAt = acknowledgedAt;
    return this.toSummary(filing);
  }

  async addFollowup(filingId: string, note: string, createdBy: string): Promise<{ followupId: string }> {
    const filing = await this.filings.findOneBy({ filingId });
    if (!filing) {
      throw new NotFoundException(`No filing with filing_id=${filingId}`);
    }
    const text = note.trim();
    if (!text) throw new BadRequestException('A follow-up note must not be empty');
    const saved = await this.followups.save({ filingId, note: text, createdBy });
    return { followupId: saved.followupId };
  }

  /** The third tracker step (screens/05, "Recording FMU feedback"): an
   * officer logs the FMU's feedback on an acknowledged filing. Status,
   * timestamp and the follow-up note land together or not at all. A
   * real officer action, not demo-only — the feedback reaches the bank
   * by its own channels and is recorded here. */
  async recordFeedback(filingId: string, note: string, recordedBy: string): Promise<FilingSummary> {
    const text = note.trim();
    if (!text) throw new BadRequestException('Describe the FMU feedback');
    return this.dataSource.transaction(async (tx) => {
      const [filing] = (await tx.query(`SELECT submission_status FROM aml_str_filings WHERE filing_id = $1 FOR UPDATE`, [
        filingId,
      ])) as Array<{ submission_status: string }>;
      if (!filing) throw new NotFoundException(`No filing with filing_id=${filingId}`);
      if (filing.submission_status !== FilingSubmissionStatus.ACKNOWLEDGED) {
        throw new BadRequestException(
          `Filing ${filingId} is ${filing.submission_status} — FMU feedback can only be recorded once it is acknowledged`,
        );
      }
      await tx.query(
        `UPDATE aml_str_filings SET submission_status = $1, feedback_received_at = now() WHERE filing_id = $2`,
        [FilingSubmissionStatus.FEEDBACK_RECEIVED, filingId],
      );
      await tx.getRepository(AmlFmuFollowup).save({ filingId, note: `FMU feedback received: ${text}`, createdBy: recordedBy });
      const updated = await tx.getRepository(AmlStrFiling).findOneByOrFail({ filingId });
      return this.toSummary(updated);
    });
  }

  private toSummary(filing: AmlStrFiling): FilingSummary {
    const retentionReviewDue = filing.retentionExpiry
      ? filing.retentionExpiry.getTime() - Date.now() <= RETENTION_REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000
      : false;

    return {
      filingId: filing.filingId,
      caseId: filing.caseId,
      reportType: filing.reportType,
      submissionStatus: filing.submissionStatus,
      goamlReference: filing.goamlReference ?? null,
      submittedAt: filing.submittedAt ? filing.submittedAt.toISOString() : null,
      acknowledgedAt: filing.acknowledgedAt ? filing.acknowledgedAt.toISOString() : null,
      feedbackReceivedAt: filing.feedbackReceivedAt ? filing.feedbackReceivedAt.toISOString() : null,
      retentionExpiry: filing.retentionExpiry ? filing.retentionExpiry.toISOString() : null,
      retentionReviewDue,
    };
  }
}
