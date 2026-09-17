import { SetMetadata } from '@nestjs/common';

export const REQUIRE_ROLES_KEY = 'requireRoles';

/** e.g. @RequireRoles('aml_detection.senior_officer_l2') — checked
 * against the current user's PlatformUser.roleCodes by RolesGuard. */
export const RequireRoles = (...roleCodes: string[]) => SetMetadata(REQUIRE_ROLES_KEY, roleCodes);
