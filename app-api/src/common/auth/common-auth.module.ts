import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../../platform/auth/auth.module.js';
import { SessionGuard } from './session.guard.js';
import { RolesGuard } from './roles.guard.js';

/** SessionGuard + RolesGuard, reusable by every feature's controllers
 * — the same mechanism every future feature's screens use, not
 * reimplemented per feature.
 *
 * Imports AuthModule (rather than its own TypeOrmModule.forFeature([
 * PlatformUser, PlatformSession])) so there is exactly one provider
 * binding for those repositories in the graph — two separate
 * forFeature() calls for the same entities in different modules
 * produced an unresolvable ambiguity for SessionGuard's constructor
 * injection. @Global() so every feature module can @UseGuards(
 * SessionGuard) without importing this module individually. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [SessionGuard, RolesGuard],
  exports: [SessionGuard, RolesGuard],
})
export class CommonAuthModule {}
