import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DashboardService, type DashboardSummary, type DashboardTrends } from './dashboard.service.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';

/** specs/suites/bfsi/features/aml-detection/screens/01-dashboard.md
 * "visible to both DemoRole.ANALYST and DemoRole.COMPLIANCE_OFFICER" —
 * SessionGuard only, no role restriction. */
@ApiTags('Dashboard')
@Controller('features/aml_detection/reports')
@UseGuards(SessionGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary-basic')
  async getSummary(): Promise<DashboardSummary> {
    return this.dashboardService.getSummary();
  }

  @Get('summary-trends')
  async getTrends(): Promise<DashboardTrends> {
    return this.dashboardService.getTrends();
  }
}
