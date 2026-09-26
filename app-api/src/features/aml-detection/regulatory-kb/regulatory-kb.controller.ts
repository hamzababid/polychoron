import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RegulatoryKbService, type IngestionJobStatus } from './regulatory-kb.service.js';
import { RegulatoryKbCommandsService } from './regulatory-kb-commands.service.js';
import { MAX_UPLOAD_BYTES, RegulatorySourceFilesService, type UploadedFileLike } from './regulatory-source-files.service.js';
import { IngestRegulatoryDocumentDto } from '../dto/ingest-regulatory-document.dto.js';
import {
  ChunkPreviewDto,
  ChunkSearchQueryDto,
  CitationsQueryDto,
  CorrectMetadataDto,
  CreateDraftDto,
  CreateProfileDto,
  DocumentListQueryDto,
  RetrievalPreviewDto,
  SaveChunksDto,
  SourceTextDto,
  SourceUrlDto,
  UpdateDraftDto,
  WithdrawDto,
} from '../dto/regulatory-kb.dto.js';
import { SessionGuard } from '../../../common/auth/session.guard.js';
import { RolesGuard } from '../../../common/auth/roles.guard.js';
import { RequireRoles } from '../../../common/auth/roles.decorator.js';
import { CurrentUser } from '../../../common/auth/current-user.decorator.js';
import type { PlatformUser } from '../../../platform/entities/index.js';

// Manifest ("Ownership and update process"): mlro_compliance_head only,
// both read and write — same accountability level as typology
// promotion. Unlike the other Phase 2 consoles, there is no read-only
// role for this one.
const MLRO = ['aml_detection.mlro_compliance_head'];
const uuid = new ParseUUIDPipe({ version: undefined });

/** specs/suites/bfsi/features/aml-detection/screens/11-regulatory-knowledge-base.md
 * and api-contracts-phase2.md, "Regulatory Knowledge Base".
 *
 * Reads hit Postgres directly (RegulatoryKbService). Every write is an
 * awaited Temporal command on the agent-service worker
 * (RegulatoryKbCommandsService) — except the raw source bytes, which
 * app-api owns (RegulatorySourceFilesService). Only embedding returns a
 * jobId. */
@ApiTags('Regulatory Knowledge Base')
@Controller('features/aml_detection/regulatory-kb')
@UseGuards(SessionGuard, RolesGuard)
@RequireRoles(...MLRO)
export class RegulatoryKbController {
  constructor(
    private readonly regulatoryKbService: RegulatoryKbService,
    private readonly commands: RegulatoryKbCommandsService,
    private readonly sourceFiles: RegulatorySourceFilesService,
  ) {}

  // ── Library & read ──────────────────────────────────────────────

  @Get('documents')
  listDocuments(@Query() query: DocumentListQueryDto) {
    return this.regulatoryKbService.listDocuments({
      status: query.status,
      sourceType: query.source_type,
      issuingAuthority: query.issuing_authority,
      tag: query.tag,
      q: query.q,
      page: query.page,
      pageSize: query.page_size,
    });
  }

  @Get('documents/:documentId')
  getDocument(@Param('documentId') documentId: string) {
    return this.regulatoryKbService.getDocument(documentId);
  }

  @Get('documents/:documentId/chunks')
  listChunks(@Param('documentId') documentId: string, @Query() query: ChunkSearchQueryDto) {
    return this.regulatoryKbService.listChunks(documentId, query.q);
  }

  @Get('documents/:documentId/versions')
  listVersions(@Param('documentId') documentId: string) {
    return this.regulatoryKbService.listVersions(documentId);
  }

  @Get('documents/:documentId/changes')
  listChanges(@Param('documentId') documentId: string) {
    return this.regulatoryKbService.listChanges(documentId);
  }

  @Get('documents/:documentId/citations')
  listCitations(@Param('documentId') documentId: string, @Query() query: CitationsQueryDto) {
    return this.regulatoryKbService.listCitations(documentId, query.page, query.page_size);
  }

  @Get('documents/:documentId/compare/:otherId')
  compare(@Param('documentId') documentId: string, @Param('otherId') otherId: string) {
    return this.regulatoryKbService.compare(documentId, otherId);
  }

  @Get('documents/:documentId/source-text')
  getSourceText(@Param('documentId') documentId: string) {
    return this.regulatoryKbService.getExtractedText(documentId);
  }

  @Get('documents/:documentId/source-file')
  async downloadSourceFile(@Param('documentId') documentId: string, @Res() res: Response): Promise<void> {
    const doc = await this.regulatoryKbService.getDocument(documentId);
    const fileId = doc.sourceFile?.fileId;
    const file = await this.sourceFiles.getWithContent(fileId ?? '00000000-0000-0000-0000-000000000000');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/["\r\n]/g, '')}"`);
    res.send(file.content);
  }

  @Get('chunking-profiles')
  listProfiles() {
    return this.regulatoryKbService.listProfiles();
  }

  @Post('chunking-profiles')
  createProfile(@Body() dto: CreateProfileDto, @CurrentUser() user: PlatformUser) {
    return this.commands.run('RegulatoryDraftCommand', { op: 'create_profile', name: dto.name, config: dto.config, created_by: user.userId });
  }

  @Get('issuing-authorities')
  listIssuingAuthorities() {
    return this.regulatoryKbService.listIssuingAuthorities();
  }

  // ── Drafts ──────────────────────────────────────────────────────

  @Post('drafts')
  createDraft(@Body() dto: CreateDraftDto, @CurrentUser() user: PlatformUser) {
    return this.commands.run('RegulatoryDraftCommand', {
      op: 'create',
      created_by: user.userId,
      source_method: dto.source_method,
      supersedes_document_id: dto.supersedes_document_id,
      copy_chunks: dto.copy_chunks ?? false,
      metadata: dto.metadata,
    });
  }

  @Patch('drafts/:documentId')
  updateDraft(@Param('documentId', uuid) documentId: string, @Body() dto: UpdateDraftDto) {
    return this.commands.run('RegulatoryDraftCommand', { op: 'update', document_id: documentId, metadata: definedOnly(dto) });
  }

  @Post('drafts/:documentId/source-file')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadSourceFile(
    @Param('documentId', uuid) documentId: string,
    @UploadedFile() file: UploadedFileLike | undefined,
    @CurrentUser() user: PlatformUser,
  ) {
    const previousFileId = (await this.regulatoryKbService.getDocument(documentId)).sourceFile?.fileId;
    const stored = await this.sourceFiles.storeUpload(file, user.userId);
    return this.extractFromFile(documentId, stored.fileId, previousFileId);
  }

  @Post('drafts/:documentId/source-url')
  @HttpCode(200)
  async fetchSourceUrl(@Param('documentId', uuid) documentId: string, @Body() dto: SourceUrlDto, @CurrentUser() user: PlatformUser) {
    const previousFileId = (await this.regulatoryKbService.getDocument(documentId)).sourceFile?.fileId;
    const stored = await this.sourceFiles.fetchAndStore(dto.url.trim(), user.userId);
    return this.extractFromFile(documentId, stored.fileId, previousFileId);
  }

  @Post('drafts/:documentId/source-text')
  @HttpCode(200)
  setSourceText(@Param('documentId', uuid) documentId: string, @Body() dto: SourceTextDto) {
    return this.commands.run('RegulatoryExtractCommand', { document_id: documentId, source_text: dto.text });
  }

  @Post('drafts/:documentId/chunk-preview')
  @HttpCode(200)
  chunkPreview(@Param('documentId', uuid) documentId: string, @Body() dto: ChunkPreviewDto) {
    return this.commands.run('RegulatoryChunkPreviewCommand', { document_id: documentId, chunking_config: dto.chunking_config });
  }

  @Put('drafts/:documentId/chunks')
  saveChunks(@Param('documentId', uuid) documentId: string, @Body() dto: SaveChunksDto) {
    return this.commands.run('RegulatoryDraftCommand', {
      op: 'save_chunks',
      document_id: documentId,
      chunks: dto.chunks.map((c) => ({ section_reference: c.section_reference, text: c.text })),
    });
  }

  @Post('drafts/:documentId/chunks/:chunkId/acknowledge-injection')
  @HttpCode(200)
  acknowledgeInjection(
    @Param('documentId', uuid) documentId: string,
    @Param('chunkId', uuid) chunkId: string,
    @CurrentUser() user: PlatformUser,
  ) {
    return this.commands.run('RegulatoryDraftCommand', {
      op: 'acknowledge_injection',
      document_id: documentId,
      chunk_id: chunkId,
      acknowledged_by: user.userId,
    });
  }

  @Post('drafts/:documentId/embed')
  async embed(@Param('documentId', uuid) documentId: string): Promise<{ jobId: string }> {
    const doc = await this.regulatoryKbService.getDocument(documentId);
    if (doc.status !== 'draft') {
      throw new ConflictException('Only a draft is embedded this way — use re-embed for a published document.');
    }
    return this.commands.startJob('RegulatoryEmbedDraftWorkflow', documentId);
  }

  @Post('drafts/:documentId/publish')
  @HttpCode(200)
  publish(@Param('documentId', uuid) documentId: string, @CurrentUser() user: PlatformUser) {
    return this.commands.run('RegulatoryPublishCommand', { document_id: documentId, published_by: user.userId }, `publish-${documentId}`);
  }

  @Delete('drafts/:documentId')
  async discard(@Param('documentId', uuid) documentId: string) {
    const result = await this.commands.run<{ document_id: string; source_file_id: string | null }>('RegulatoryDraftCommand', {
      op: 'discard',
      document_id: documentId,
    });
    if (result.source_file_id) await this.sourceFiles.deleteIfOrphaned(result.source_file_id);
    return result;
  }

  // ── Live documents ──────────────────────────────────────────────

  @Patch('documents/:documentId/metadata')
  correctMetadata(@Param('documentId', uuid) documentId: string, @Body() dto: CorrectMetadataDto, @CurrentUser() user: PlatformUser) {
    return this.commands.run('RegulatoryMetadataCommand', {
      op: 'correct',
      document_id: documentId,
      changes: dto.changes,
      reason: dto.reason,
      changed_by: user.userId,
    });
  }

  @Post('documents/:documentId/withdraw')
  @HttpCode(200)
  withdraw(@Param('documentId', uuid) documentId: string, @Body() dto: WithdrawDto, @CurrentUser() user: PlatformUser) {
    return this.commands.run(
      'RegulatoryMetadataCommand',
      { op: 'withdraw', document_id: documentId, reason: dto.reason, withdrawn_by: user.userId },
      `withdraw-${documentId}`,
    );
  }

  @Post('documents/:documentId/reembed')
  async reembed(@Param('documentId', uuid) documentId: string): Promise<{ jobId: string }> {
    await this.regulatoryKbService.assertExists(documentId);
    return this.commands.startJob('RegulatoryReembedWorkflow', documentId);
  }

  @Post('retrieval-preview')
  @HttpCode(200)
  retrievalPreview(@Body() dto: RetrievalPreviewDto) {
    return this.commands.run('RegulatoryRetrievalPreviewCommand', {
      query: dto.query,
      top_k: dto.top_k ?? 5,
      include_draft_document_id: dto.include_draft_document_id,
    });
  }

  // ── Jobs ────────────────────────────────────────────────────────

  @Get('jobs/:jobId')
  getJob(@Param('jobId') jobId: string): Promise<IngestionJobStatus> {
    return this.regulatoryKbService.getJobStatus(jobId);
  }

  /** Alias kept until the old single-page screen's callers are gone. */
  @Get('ingestion-jobs/:jobId')
  getJobStatus(@Param('jobId') jobId: string): Promise<IngestionJobStatus> {
    return this.regulatoryKbService.getJobStatus(jobId);
  }

  /** One-shot ingest — kept for scripts/tests; the screens use drafts. */
  @Post('documents')
  ingest(@Body() dto: IngestRegulatoryDocumentDto): Promise<{ jobId: string }> {
    return this.regulatoryKbService.startIngestion(dto);
  }

  /** The draft points at the new file only if extraction succeeds; a
   * file nothing references (failed extraction, or the draft's previous
   * source after a replacement) is removed. */
  private async extractFromFile(documentId: string, fileId: string, previousFileId?: string) {
    try {
      const result = await this.commands.run('RegulatoryExtractCommand', { document_id: documentId, file_id: fileId });
      if (previousFileId && previousFileId !== fileId) await this.sourceFiles.deleteIfOrphaned(previousFileId);
      return result;
    } catch (err) {
      await this.sourceFiles.deleteIfOrphaned(fileId);
      throw err;
    }
  }
}

function definedOnly<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}
