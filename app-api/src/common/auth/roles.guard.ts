import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformUser } from '../../platform/entities/index.js';
import { REQUIRE_ROLES_KEY } from './roles.decorator.js';

/**
 * Must run after SessionGuard (which populates request.currentUser) —
 * always pair as @UseGuards(SessionGuard, RolesGuard). Enforces
 * server-side regardless of what the frontend shows/hides — a hidden
 * UI element is not access control (constitution rule 7).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ currentUser?: PlatformUser }>();
    const user = request.currentUser;
    if (!user) {
      // SessionGuard should have populated this — fail closed rather
      // than assume access if it somehow didn't run first.
      throw new ForbiddenException('No authenticated user on request');
    }

    const hasRequiredRole = user.roleCodes.some((code) => requiredRoles.includes(code));
    if (!hasRequiredRole) {
      throw new ForbiddenException(`This action requires one of: ${requiredRoles.join(', ')}`);
    }
    return true;
  }
}
