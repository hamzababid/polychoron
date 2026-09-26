import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  RegulatoryKbService,
  type IngestionJobStatus,
  type RegulatoryChunkRow,
  type RegulatoryDocumentRow,
} from './regulatory-kb.service.js';
import { IngestRegulatoryDocumentDto } from '../dto/ingest-regulatory-document.dto.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';

// Manifest ("Ownership and update process"): mlro_compliance_head only,
// both read and write — same accountability level as typology
// promotion. Unlike the other Phase 2 consoles, there is no read-only
// role for this one.
const MLRO = ['aml_detection.mlro_compliance_head'];

/** specs/platform/10-regulatory-knowledge-base-spec.md's deferred
 * management screen — TASKS.md "Regulatory Knowledge Base —
 * management screen". */
@ApiTags('Regulatory Knowledge Base')
@Controller('features/aml_detection/regulatory-kb')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles(...MLRO)
export class RegulatoryKbController {
  constructor(private readonly regulatoryKbService: RegulatoryKbService) {}

  @Get('documents')
  async listDocuments(): Promise<RegulatoryDocumentRow[]> {
    return this.regulatoryKbService.listDocuments();
  }

  @Get('documents/:documentId/chunks')
  async listChunks(@Param('documentId') documentId: string): Promise<RegulatoryChunkRow[]> {
    return this.regulatoryKbService.listChunks(documentId);
  }

  @Post('documents')
  async ingest(@Body() dto: IngestRegulatoryDocumentDto): Promise<{ jobId: string }> {
    return this.regulatoryKbService.startIngestion(dto);
  }

  @Post('documents/:documentId/reembed')
  async reembed(@Param('documentId') documentId: string): Promise<{ jobId: string }> {
    return this.regulatoryKbService.startReembed(documentId);
  }

  @Get('ingestion-jobs/:jobId')
  async getJobStatus(@Param('jobId') jobId: string): Promise<IngestionJobStatus> {
    return this.regulatoryKbService.getJobStatus(jobId);
  }
}
