import { IsString } from 'class-validator';

export class AddFollowupDto {
  @IsString()
  note!: string;

  @IsString()
  created_by!: string;
}
