import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

/** specs/platform/02-platform-data-models.py::PlatformSession */
@Entity({ name: 'platform_sessions' })
export class PlatformSession {
  @PrimaryColumn({ name: 'session_id' })
  sessionId!: string;

  @Column({ name: 'user_id' })
  userId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt?: Date;
}
