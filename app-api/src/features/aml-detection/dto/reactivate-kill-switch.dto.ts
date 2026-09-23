import { IsString } from 'class-validator';

export class ReactivateKillSwitchDto {
  @IsString()
  reactivated_by!: string;
}
