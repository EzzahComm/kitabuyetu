/**
 * RBAC permission activation (SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4),
 * platform-role axis. `/api/v1/organization/*` was previously gated 3 layers
 * deep in organizationService.assertOrganizationCoordinator, invisible from
 * the route file. This makes that gate an explicit, visible route-level
 * check — but deliberately NOT DB-backed like lib/auth/permissions.ts:
 * roles.base_role is typed `member_role` and cannot represent
 * organization_coordinator/super_admin at all (they're platform roles, not
 * group-member roles), and ROLE_HIERARCHY even ranks organization_coordinator
 * (10) below plain member (20) — a numeric rank comparison would be actively
 * wrong here, which is exactly why organizationService.assertOrganizationCoordinator
 * and withPlatformRole both already use flat exact-match allowlists, never
 * hasRole. This mirrors that established shape rather than inventing new
 * DB schema for an axis nothing else uses permission strings for.
 */
import type { MemberRole, PlatformRole } from '@/types/enums';
import { ForbiddenError } from '@/lib/utils/errors';

// Every permission below currently maps to the exact same two roles because
// no route in the real inventory distinguishes coordinator-vs-super_admin
// capability within the org domain — intentionally a flat map today. If a
// narrower split is ever needed (e.g. a read-only coordinator tier), this is
// the one place to add it — do not fork the roles table for it.
export const ORGANIZATION_PERMISSIONS = [
  'organization.profile.view',
  'organization.branding.manage',
  'organization.groups.view',
  'organization.members.view',
  'organization.audit_logs.view',
  'organization.reports.view',
  'organization.dashboard.view',
  'organization.programs.manage',
  'organization.disbursements.manage',
  'organization.wallet.view',
  'organization.sms.manage',
  'organization.accounting.view',
  'organization.policies.manage',
  // Capital & Investment Layer (docs/capital-layer/). These live here, on the
  // code-level org axis, and NOT in roles.permissions — per the note above,
  // roles.base_role is typed member_role and cannot represent org roles.
  // Consequence: no roles migration, and no edit to clear-tenant-data.sql's
  // reseed block (the drift trap documented at that file's line 141).
  'capital.product.view',
  'capital.product.manage',
] as const;
export type OrganizationPermission = typeof ORGANIZATION_PERMISSIONS[number];

const ORG_AXIS_ROLES: (MemberRole | PlatformRole)[] = ['organization_coordinator', 'super_admin'];

export function hasOrganizationPermission(role: MemberRole | PlatformRole): boolean {
  return ORG_AXIS_ROLES.includes(role);
}

/**
 * Structural subset of what this check actually reads. Deliberately NOT
 * `AuthContext`: the same rule has to apply to a backoffice/organization
 * caller too (whose role lives on `platformRole` and who has no group at
 * all), and duplicating the rule per context shape is how the two would
 * drift. Both `AuthContext` and an adapted backoffice context satisfy this.
 */
export interface OrganizationActor {
  role:            MemberRole | PlatformRole;
  organizationId?: string;
}

/** _permission is unused today (flat map) but kept in the signature so a future narrower split doesn't need every call site rewritten. */
export function requireOrganizationPermission(auth: OrganizationActor, _permission: OrganizationPermission): void {
  if (!hasOrganizationPermission(auth.role)) {
    throw new ForbiddenError(
      `Role '${auth.role}' cannot perform this action — organization_coordinator or super_admin required`,
    );
  }
  if (auth.role === 'organization_coordinator' && !auth.organizationId) {
    throw new ForbiddenError('Organization context is required');
  }
}
