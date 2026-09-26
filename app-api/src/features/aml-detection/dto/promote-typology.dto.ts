import { IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

/** The promoting user always comes from the session — no `promoted_by`
 * here (screens/06-typology-rules-console.md, "Acting user"). */
export class PromoteTypologyDto {
  @IsOptional()
  @IsUUID()
  backtest_job_id?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
