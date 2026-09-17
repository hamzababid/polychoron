import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { PlatformSession, PlatformUser } from '../entities/index.js';

export interface DemoSessionResponse {
  sessionId: string;
  user: {
    userId: string;
    displayName: string;
    email: string;
    roleCodes: string[];
  };
  createdAt: string;
}

/**
 * specs/platform/00-constitution.md rule 9 (phase discipline): this is
 * a seeded-user picker, not real authentication — no password check,
 * no token issuance/refresh, no expiry enforcement. It is built to be
 * discarded wholesale when Phase 3's real SSO/OIDC lands
 * (specs/platform/05-rbac-platform-spec.md), not evolved into it.
 *
 * DemoUser/DemoSession from the spec aren't modeled as separate
 * throwaway types here — they resolve directly to PlatformUser/
 * PlatformSession, which are already the platform-level entities
 * Phase 3's real RBAC will keep using. What's "demo" about this stub
 * is the login method, not the data shape.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(PlatformUser) private readonly users: Repository<PlatformUser>,
    @InjectRepository(PlatformSession) private readonly sessions: Repository<PlatformSession>,
  ) {}

  async demoLogin(userId: string): Promise<DemoSessionResponse> {
    const user = await this.users.findOneBy({ userId });
    if (!user) {
      throw new UnauthorizedException(`No demo user with user_id=${userId}`);
    }

    const session = await this.sessions.save({
      sessionId: randomUUID(),
      userId: user.userId,
    });

    return {
      sessionId: session.sessionId,
      user: {
        userId: user.userId,
        displayName: user.displayName,
        email: user.email,
        roleCodes: user.roleCodes,
      },
      createdAt: session.createdAt.toISOString(),
    };
  }
}
