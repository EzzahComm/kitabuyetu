'use client';

/**
 * Client-side counterpart to lib/auth/permissions.ts / organization-permissions.ts
 * (UX_UI_OPTIMIZATION_AUDIT_2026-08.md Phase 1). Both underlying helpers are
 * pure/client-safe already — this just wires them up to useAuth()'s state so
 * components can gate UI on the exact same permission strings the API
 * already enforces, instead of rendering every action for every role and
 * relying on a silent 403.
 *
 * Client-side gating is a UX affordance only — the API remains the
 * authoritative check. A stale/forged client value can at worst show a
 * button that still 403s; it can never grant access the server wouldn't.
 */
import { useAuth, isTenantUser } from '@/lib/auth/context';
import { hasPermission } from '@/lib/auth/permissions';
import { hasOrganizationPermission } from '@/lib/auth/organization-permissions';

/** Mirrors login/refresh's `effectiveRole` computation (server-side: role.ts
 *  routes' `member.platform_role === 'super_admin' ? 'super_admin' : chosen.group_role`)
 *  — the client's TenantUser.groupRole is never overridden for super_admin,
 *  so this must be re-derived the same way here. */
export function useHasPermission(permission: string): boolean {
  const { user } = useAuth();
  if (!user || !isTenantUser(user)) return false;
  const role = user.platformRole === 'super_admin' ? 'super_admin' : user.groupRole;
  return hasPermission({ role, permissions: user.permissions }, permission);
}

/** Organization/* platform-role axis — a flat allowlist on platformRole, not
 *  a group-role permission string (lib/auth/organization-permissions.ts). */
export function useHasOrganizationPermission(): boolean {
  const { user } = useAuth();
  if (!user) return false;
  return hasOrganizationPermission(user.platformRole);
}
