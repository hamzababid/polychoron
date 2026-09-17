import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { FilingConsoleService, type FilingDraftResponse } from './filing-console.service.js';
import { AttestFilingDto } from '../dto/attest-filing.dto.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

/** specs/suites/bfsi/features/aml-detection/screens/04-filing-console.md
 * "DemoRole.COMPLIANCE_OFFICER only — DemoRole.ANALYST must not reach
 * this route (enforce server-side even in the demo stub)." — every
 * endpoint here is guarded identically; a hidden UI element on the
 * frontend is not access control (constitution rule 7). */
@Controller('features/aml_detection/cases')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles('aml_detection.senior_officer_l2', 'aml_detection.mlro_compliance_head')
export class FilingConsoleController {
  constructor(private readonly filingConsoleService: FilingConsoleService) {}

  @Get(':caseId/filing-draft')
  async getFilingDraft(@Param('caseId') caseId: string): Promise<FilingDraftResponse> {
    return this.filingConsoleService.getFilingDraft(caseId);
  }

  @Post(':caseId/filing/attest')
  async attest(@Param('caseId') caseId: string, @Body() dto: AttestFilingDto): Promise<FilingDraftResponse> {
    return this.filingConsoleService.attest(caseId, dto);
  }

  @Post(':caseId/filing/submit')
  async submit(@Param('caseId') caseId: string): Promise<FilingDraftResponse> {
    return this.filingConsoleService.submit(caseId);
  }
}
