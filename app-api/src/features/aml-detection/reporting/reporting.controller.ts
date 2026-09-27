import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ReportingService, type ReportHistoryEntry, type ReportingSummary } from './reporting.service.js';
import { ReportingSummaryQueryDto } from '../dto/reporting-summary-query.dto.js';
import { GenerateReportDto } from '../dto/generate-report.dto.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

const MLRO = 'aml_detection.mlro_compliance_head';

class ReportHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 10;
}

/** specs/suites/bfsi/features/aml-detection/screens/10-reporting-mi.md
 * RBAC: mlro_compliance_head only, per the screen spec — the whole
 * controller is gated, not per-route, since every route here is
 * reporting/export, nothing an analyst or senior officer needs. */
@ApiTags('Reporting & MI')
@Controller('features/aml_detection/reports')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles(MLRO)
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('summary')
  async getSummary(@Query() query: ReportingSummaryQueryDto): Promise<ReportingSummary> {
    return this.reportingService.getSummary({
      periodStart: new Date(query.period_start),
      periodEnd: new Date(query.period_end),
      comparePrevious: query.compare_previous ?? false,
      breakdownBy: query.breakdown_by ?? 'type',
    });
  }

  @Post('generate')
  async generate(@Body() dto: GenerateReportDto): Promise<ReportHistoryEntry> {
    return this.reportingService.generateReport(dto);
  }

  // Paged: every generated report is kept (the hash is the audit
  // trail), so this list only ever grows.
  @Get('history')
  async getHistory(
    @Query() query: ReportHistoryQueryDto,
  ): Promise<{ items: ReportHistoryEntry[]; total: number; page: number; pageSize: number }> {
    const page = query.page ?? 1;
    const pageSize = query.page_size ?? 10;
    const { items, total } = await this.reportingService.getHistory(page, pageSize);
    return { items, total, page, pageSize };
  }

  @Get(':reportId/download')
  async download(@Param('reportId') reportId: string, @Res() res: Response): Promise<void> {
    const file = await this.reportingService.getReportFile(reportId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
    res.send(file.content);
  }
}
