import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString } from 'class-validator';

/** specs/suites/bfsi/features/aml-detection/data-models.py::STRFieldsDraft
 * Officer-editable copy of the agent's draft (constitution-addendum
 * A1: never gains a suspicion-rationale field). */
export class StrFieldsDraftDto {
  @IsString()
  party_name!: string;

  @IsString()
  party_cnic!: string;

  @IsString()
  party_address!: string;

  @IsString()
  party_occupation!: string;

  @IsArray()
  @IsString({ each: true })
  account_ids!: string[];

  @IsArray()
  @IsString({ each: true })
  transaction_refs!: string[];

  @IsNumber()
  @Type(() => Number)
  total_amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  typology_tag!: string;

  @IsString()
  reporting_entity!: string;
}
