import { type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { PlatformSession, PlatformUser } from '../../platform/entities/index.js';

/**
 * Resolves the `x-session-id` header (from a demo-login session, see
 * platform/auth/) to a PlatformUser and attaches it to the request as
 * `currentUser`. This is the Phase 1 stand-in for real session/token
 * validation — no expiry check (constitution rule 9, the demo auth
 * stub explicitly has none), replaced wholesale in Phase 3.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @InjectRepository(PlatformSession) private readonly sessions: Repository<PlatformSession>,
    @InjectRepository(PlatformUser) private readonly users: Repository<PlatformUser>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: Record<string, unknown>; currentUser?: PlatformUser }>();
    const sessionId = request.headers['x-session-id'];
    if (!sessionId || typeof sessionId !== 'string') {
      throw new UnauthorizedException('Missing x-session-id header');
    }

    const session = await this.sessions.findOneBy({ sessionId });
    if (!session) {
      throw new UnauthorizedException('Invalid session');
    }

    const user = await this.users.findOneBy({ userId: session.userId });
    if (!user) {
      throw new UnauthorizedException('Session user no longer exists');
    }

    request.currentUser = user;
    return true;
  }
}
