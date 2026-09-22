import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RecordSamplingReviewDto {
  @IsString()
  reviewer_id!: string;

  @IsBoolean()
  reviewer_agreed!: boolean;

  @IsOptional()
  @IsString()
  reviewer_notes?: string;
}
