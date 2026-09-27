import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** The author is always the session user — never a body field. */
export class AddFollowupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}

/** screens/05-goaml-tracker.md — "Recording FMU feedback". */
export class RecordFeedbackDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}
