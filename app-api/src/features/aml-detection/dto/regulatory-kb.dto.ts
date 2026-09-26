import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** specs/suites/bfsi/features/aml-detection/phase-2-full-aml/api-contracts-phase2.md,
 * "Regulatory Knowledge Base". Shape checks only — agent-service's
 * lifecycle.py is the authority on business rules (and migration 013's
 * triggers underneath it). The acting user always comes from the
 * session, never from the body. */

// Content that crosses a Temporal payload (pasted text, a full chunk
// list) is capped at 1.5 MB — see spec 10, "Awaited-command mechanics".
const MAX_TEXT = 1_500_000;

export class DocumentListQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() source_type?: string;
  @IsOptional() @IsString() issuing_authority?: string;
  @IsOptional() @IsString() tag?: string;
  @IsOptional() @IsString() q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class ChunkSearchQueryDto {
  @IsOptional() @IsString() q?: string;
}

export class CitationsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) page_size?: number;
}

export class CreateDraftDto {
  @IsIn(['upload', 'paste', 'url', 'manual'])
  source_method!: string;

  @IsOptional() @IsUUID() supersedes_document_id?: string;
  @IsOptional() @IsBoolean() copy_chunks?: boolean;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpdateDraftDto {
  @IsOptional() @IsString() @MaxLength(500) title?: string;
  @IsOptional() @IsString() source_type?: string;
  @IsOptional() @IsString() @MaxLength(200) issuing_authority?: string;
  @IsOptional() @IsString() @MaxLength(200) version_label?: string;
  @IsOptional() @IsString() effective_date?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) source_url?: string | null;
  @IsOptional() @IsString() @MaxLength(20) jurisdiction?: string;
  @IsOptional() @IsString() @MaxLength(20) language?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) related_typology_codes?: string[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string | null;
  @IsOptional() @IsBoolean() retrieval_enabled?: boolean;
  @IsOptional() @Type(() => Number) retrieval_priority?: number;
  @IsOptional() @IsObject() chunking_config?: Record<string, unknown>;
}

export class SourceTextDto {
  @IsString() @MaxLength(MAX_TEXT) text!: string;
}

export class SourceUrlDto {
  @IsString() @MaxLength(2000) url!: string;
}

export class ChunkPreviewDto {
  @IsObject() chunking_config!: Record<string, unknown>;
}

export class ChunkInputDto {
  @IsString() @MaxLength(300) section_reference!: string;
  @IsString() @MaxLength(MAX_TEXT) text!: string;
}

export class SaveChunksDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => ChunkInputDto)
  chunks!: ChunkInputDto[];
}

export class CorrectMetadataDto {
  @IsObject() changes!: Record<string, unknown>;
  @IsString() @MaxLength(2000) reason!: string;
}

export class WithdrawDto {
  @IsString() @MaxLength(2000) reason!: string;
}

export class RetrievalPreviewDto {
  @IsString() @MaxLength(2000) query!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) top_k?: number;
  @IsOptional() @IsUUID() include_draft_document_id?: string;
}

export class CreateProfileDto {
  @IsString() @MaxLength(120) name!: string;
  @IsObject() config!: Record<string, unknown>;
}
