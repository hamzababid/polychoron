import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PlatformUser } from '../../platform/entities/index.js';

/** Populated by SessionGuard — use only on routes guarded by it. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): PlatformUser => {
  const request = ctx.switchToHttp().getRequest<{ currentUser: PlatformUser }>();
  return request.currentUser;
});
