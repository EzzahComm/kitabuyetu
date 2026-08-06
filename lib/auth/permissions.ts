/**
 * RBAC permission activation (SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4).
 *
 * Permission strings are resolved from group_members.role_id -> roles.permissions
 * at token-issue time (see login/refresh/switch-group) and travel as an
 * AuthContext.permissions claim, checked here.
 *
 * super_admin bypasses every permission check, mirroring how it already
 * bypasses withRole's numeric ROLE_HIERARCHY ladder (rank 100) and how
 * ROLES.canViewPII already special-cases it inline (lib/auth/rbac.ts) — not
 * a literal "has every permission string" array, which would need to be kept
 * in sync with every future permission string ever added.
 */
import { ForbiddenError } from '@/lib/utils/errors';

interface PermissionCheckable {
  role:         string;
  permissions?: string[];
}

export function hasPermission(auth: PermissionCheckable, required: string): boolean {
  if (auth.role === 'super_admin') return true;
  return (auth.permissions ?? []).includes(required);
}

export function requirePermission(auth: PermissionCheckable, required: string): void {
  if (!hasPermission(auth, required)) {
    throw new ForbiddenError(`Missing permission '${required}'`);
  }
}

export function requireAnyPermission(auth: PermissionCheckable, allowed: string[]): void {
  if (!allowed.some((p) => hasPermission(auth, p))) {
    throw new ForbiddenError(`Missing permission — one of: ${allowed.join(', ')}`);
  }
}
