import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  q!: string;
}
