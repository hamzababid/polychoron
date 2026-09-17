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
  retentionExpiry: string | null;
  retentionReviewDue: boolean;
}

export interface FilingDetail extends FilingSummary {
  payload: Record<string, unknown>;
  finalNarrative: string;
  followups: Array<{ followupId: string; note: string; createdBy: string; createdAt: string }>;
}

@Injectable()
export class GoamlTrackerService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AmlStrFiling) private readonly filings: Repository<AmlStrFiling>,
    @InjectRepository(AmlFmuFollowup) private readonly followups: Repository<AmlFmuFollowup>,
  ) {}

  async list(page: number, pageSize: number): Promise<{ items: FilingSummary[]; total: number }> {
    const [rows, total] = await this.filings.findAndCount({
      order: { submittedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items: rows.map((f) => this.toSummary(f)), total };
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
    const saved = await this.followups.save({ filingId, note, createdBy });
    return { followupId: saved.followupId };
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
      retentionExpiry: filing.retentionExpiry ? filing.retentionExpiry.toISOString() : null,
      retentionReviewDue,
    };
  }
}
