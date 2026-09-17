import { Controller, Get, UseGuards } from '@nestjs/common';
import { DashboardService, type DashboardSummary } from './dashboard.service.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';

/** specs/suites/bfsi/features/aml-detection/screens/01-dashboard.md
 * "visible to both DemoRole.ANALYST and DemoRole.COMPLIANCE_OFFICER" —
 * SessionGuard only, no role restriction. */
@Controller('features/aml_detection/reports')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary-basic')
  async getSummary(): Promise<DashboardSummary> {
    return this.dashboardService.getSummary();
  }
}
