import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

const SOURCE_TYPES = ['statute', 'regulation', 'circular', 'guidance', 'international'];

export class RegulatoryChunkInputDto {
  @IsString()
  section_reference!: string;

  @IsString()
  text!: string;
}

export class IngestRegulatoryDocumentDto {
  @IsString()
  title!: string;

  @IsIn(SOURCE_TYPES)
  source_type!: string;

  @IsString()
  issuing_authority!: string;

  @IsString()
  version_label!: string;

  @IsOptional()
  @IsString()
  source_url?: string;

  @IsString()
  ingested_by!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RegulatoryChunkInputDto)
  chunks!: RegulatoryChunkInputDto[];

  /** Set when this ingestion replaces an existing document — the old
   * document's superseded_by is set to the new one, never deleted. */
  @IsOptional()
  @IsString()
  supersedes_document_id?: string;
}
