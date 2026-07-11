import type { MemberRole, PlatformRole } from '@/types/enums';
import { ROLE_HIERARCHY } from '@/types/enums';
import { ForbiddenError } from '@/lib/utils/errors';

type AnyRole = MemberRole | PlatformRole;

/** Returns true if the caller's role has at least as much privilege as required. */
export function hasRole(callerRole: AnyRole, requiredRole: AnyRole): boolean {
  return (ROLE_HIERARCHY[callerRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

/** Throws ForbiddenError if the caller does not have the required role. */
export function requireRole(callerRole: AnyRole, requiredRole: AnyRole): void {
  if (!hasRole(callerRole, requiredRole)) {
    throw new ForbiddenError(
      `Role '${callerRole}' cannot perform this action — '${requiredRole}' or higher required`,
    );
  }
}

/** Throws ForbiddenError if the caller is not one of the allowed roles. */
export function requireOneOf(callerRole: AnyRole, allowed: AnyRole[]): void {
  if (!allowed.includes(callerRole)) {
    throw new ForbiddenError(
      `Role '${callerRole}' is not permitted. Allowed: ${allowed.join(', ')}`,
    );
  }
}

export const ROLES = {
  canManageMembers: (role: AnyRole) =>
    hasRole(role, 'secretary'),

  canManageFinances: (role: AnyRole) =>
    hasRole(role, 'treasurer'),

  canApproveLoan: (role: AnyRole) =>
    hasRole(role, 'treasurer'),

  canPostJournal: (role: AnyRole) =>
    hasRole(role, 'treasurer'),

  canManageSubscription: (role: AnyRole) =>
    hasRole(role, 'chairperson'),

  canViewPII: (role: AnyRole) =>
    hasRole(role, 'treasurer') || role === 'super_admin',

  canAdminGroup: (role: AnyRole) =>
    hasRole(role, 'chairperson'),

  isSuperAdmin: (role: AnyRole) =>
    role === 'super_admin',

  isOrganizationCoordinator: (role: AnyRole) =>
    role === 'organization_coordinator',
};
