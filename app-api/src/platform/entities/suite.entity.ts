import { Column, Entity, PrimaryColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::Suite. Written by app-api
 * only (platform registry seeding); agent-service never writes here. */
@Entity({ name: 'suites' })
export class Suite {
  @PrimaryColumn({ name: 'suite_code' })
  suiteCode!: string;

  @Column({ name: 'suite_name' })
  suiteName!: string;

  @Column()
  description!: string;
}
