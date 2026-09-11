import { NextRequest } from 'next/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/utils/errors';
import { handleError } from '@/lib/utils/response';
import type { AuthContext } from '@/types/api.types';
import type { TenantContext } from '@/lib/db';
import type { MemberRole, PlatformRole } from '@/types/enums';
import { requireRole, requireOneOf } from './rbac';
import { requirePermission, requireAnyPermission } from './permissions';
import { requireOrganizationPermission, type OrganizationPermission } from './organization-permissions';
import { assertSubscriptionActive } from './subscription-gate';

// ─── Tenant (consumer) context ─────────────────────────────────────────

/**
 * Extract the AuthContext that the edge middleware stamped onto request headers
 * for a TENANT (consumer) request. Throws UnauthorizedError if the headers are
 * missing (request bypassed middleware) or if this is a backoffice token (which
 * the proxy stamps with `x-aud: backoffice` and should never reach a tenant route).
 */
export function getAuthContext(req: NextRequest): AuthContext {
  const userId  = req.headers.get('x-user-id');
  const groupId = req.headers.get('x-group-id');
  const role    = req.headers.get('x-role') as MemberRole | PlatformRole | null;
  const organizationId   = req.headers.get('x-organization-id') ?? undefined;
  const aud     = req.headers.get('x-aud');

  if (aud === 'backoffice') {
    throw new ForbiddenError('Backoffice token cannot be used on tenant routes');
  }
  if (!userId || !groupId || !role) {
    throw new UnauthorizedError('Missing authentication context');
  }

  // Active Membership Context + epochs (§2.1/§2.5) — proxy-stamped from the
  // JWT; absent on legacy tokens.
  const membershipId  = req.headers.get('x-membership-id') ?? undefined;
  const membershipNo  = req.headers.get('x-membership-no') ?? undefined;
  const authVersionH  = req.headers.get('x-auth-version');
  const sessionVersionH = req.headers.get('x-session-version');
  const permissionsH  = req.headers.get('x-permissions');

  return {
    userId, groupId, role, organizationId,
    membershipId, membershipNo,
    authVersion:    authVersionH    != null ? Number(authVersionH)    : undefined,
    sessionVersion: sessionVersionH != null ? Number(sessionVersionH) : undefined,
    permissions:    permissionsH    != null ? permissionsH.split(',').filter(Boolean) : undefined,
  };
}

/**
 * Higher-order handler that extracts auth context and passes it to the handler.
 * Handles all AppError and unexpected errors uniformly.
 */
export function withAuth<T extends unknown[]>(
  req: NextRequest,
  handler: (auth: AuthContext, ...args: T) => Promise<Response>,
  ...args: T
): Promise<Response> {
  try {
    const auth = getAuthContext(req);
    // Every tenant route reaches the handler through here — withRole,
    // withOneOf, withPermission and withAnyPermission all delegate to it — so
    // this is the one place a paid-subscription check covers the whole tenant
    // surface. The gate carves out the routes a locked group needs in order to
    // pay; see lib/auth/subscription-gate.ts.
    return assertSubscriptionActive(req, auth)
      .then(() => handler(auth, ...args))
      .catch(handleError);
  } catch (err) {
    return Promise.resolve(handleError(err));
  }
}

/** withAuth variant that also enforces a minimum role before calling the handler. */
export function withRole(
  req: NextRequest,
  requiredRole: MemberRole | PlatformRole,
  handler: (auth: AuthContext) => Promise<Response>,
): Promise<Response> {
  return withAuth(req, async (auth) => {
    requireRole(auth.role, requiredRole);
    return handler(auth);
  });
}

/** withAuth variant that enforces one-of-many allowed roles. */
export function withOneOf(
  req: NextRequest,
  allowed: (MemberRole | PlatformRole)[],
  handler: (auth: AuthContext) => Promise<Response>,
): Promise<Response> {
  return withAuth(req, async (auth) => {
    requireOneOf(auth.role, allowed);
    return handler(auth);
  });
}

/**
 * withAuth variant that enforces a specific permission string (RBAC
 * activation — SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4), resolved from
 * roles.permissions at token-issue time rather than a coarse role tier.
 * super_admin bypasses this check (see lib/auth/permissions.ts).
 */
export function withPermission(
  req: NextRequest,
  required: string,
  handler: (auth: AuthContext) => Promise<Response>,
): Promise<Response> {
  return withAuth(req, async (auth) => {
    requirePermission(auth, required);
    return handler(auth);
  });
}

/** withAuth variant that enforces one-of-many allowed permission strings. */
export function withAnyPermission(
  req: NextRequest,
  allowed: string[],
  handler: (auth: AuthContext) => Promise<Response>,
): Promise<Response> {
  return withAuth(req, async (auth) => {
    requireAnyPermission(auth, allowed);
    return handler(auth);
  });
}

// The old `withOrganizationPermission` lived here. It was built on
// withAuth/getAuthContext and so required a TENANT token with a groupId,
// which an organization coordinator never has — see withOrganizationAccess
// at the foot of this file for the full story. Deleted rather than left
// unused: it typechecks fine and reads plausibly, so the next organization
// route to be added would have reached for it and silently reintroduced the
// same outage.

// ─── Backoffice (platform staff) context ───────────────────────────────

export type AdminPlatformRole = Exclude<PlatformRole, 'member'>;

export interface BackofficeContext {
  userId:       string;
  platformRole: AdminPlatformRole;
  organizationId?:       string;
}

/**
 * Extract the backoffice-staff context the proxy stamped for an admin request.
 * Use this in /api/admin/* routes; the proxy already enforces that the token
 * has `aud: 'backoffice'` before stamping these headers.
 */
export function getBackofficeContext(req: NextRequest): BackofficeContext {
  const userId       = req.headers.get('x-user-id');
  const platformRole = req.headers.get('x-platform-role') as AdminPlatformRole | null;
  const organizationId        = req.headers.get('x-organization-id') ?? undefined;
  const aud          = req.headers.get('x-aud');

  if (aud !== 'backoffice') {
    throw new ForbiddenError('Tenant token cannot be used on backoffice routes');
  }
  if (!userId || !platformRole) {
    throw new UnauthorizedError('Missing backoffice authentication context');
  }
  if (platformRole !== 'super_admin' && platformRole !== 'support' && platformRole !== 'organization_coordinator') {
    throw new ForbiddenError(`Role '${platformRole}' is not a valid backoffice role`);
  }
  return { userId, platformRole, organizationId };
}

/** Higher-order handler for backoffice routes. Mirrors withAuth's shape. */
export function withBackofficeAuth<T extends unknown[]>(
  req: NextRequest,
  handler: (ctx: BackofficeContext, ...args: T) => Promise<Response>,
  ...args: T
): Promise<Response> {
  try {
    const ctx = getBackofficeContext(req);
    return handler(ctx, ...args).catch(handleError);
  } catch (err) {
    return Promise.resolve(handleError(err));
  }
}

/**
 * Enforce that the backoffice caller has one of the allowed platform roles.
 * Unlike withOneOf (tenant), this uses an explicit allowlist rather than the
 * numeric ROLE_HIERARCHY — the platform-role tier doesn't have a meaningful
 * "rank" (a `support` is not "lesser than" a `super_admin`, just different
 * scope), so a flat allowlist is the right shape here.
 */
export function withPlatformRole(
  req: NextRequest,
  allowed: AdminPlatformRole | AdminPlatformRole[],
  handler: (ctx: BackofficeContext) => Promise<Response>,
): Promise<Response> {
  const list = Array.isArray(allowed) ? allowed : [allowed];
  return withBackofficeAuth(req, async (ctx) => {
    if (!list.includes(ctx.platformRole)) {
      throw new ForbiddenError(
        `Role '${ctx.platformRole}' cannot perform this action. Allowed: ${list.join(', ')}`,
      );
    }
    return handler(ctx);
  });
}

/**
 * Guard for the organization axis under `/api/admin/organization/*`.
 *
 * Replaces the old `withOrganizationPermission`, which was built on
 * `withAuth`/`getAuthContext` and therefore demanded a TENANT token carrying a
 * `groupId`. An organization coordinator signs in through the enterprise
 * portal and holds a BACKOFFICE token: `aud: 'backoffice'`, a `platformRole`,
 * an `organizationId`, and no group whatsoever. `getAuthContext` rejects that
 * token on both counts, so every organization route answered "Missing
 * authentication context" and the portal built to consume them could never
 * load. Same audience-bucket defect that already forced `switch-org` from
 * `/api/v1/` to `/api/admin/`; the routes now live in the bucket whose token
 * they actually receive.
 *
 * The handler is given a `TenantContext` with NO `groupId` — organization
 * scoping is `organizationId` (+ the app.current_organization_id GUC), and
 * the services only ever read `ctx.organizationId` for it.
 */
export function withOrganizationAccess(
  req: NextRequest,
  permission: OrganizationPermission,
  handler: (ctx: TenantContext) => Promise<Response>,
): Promise<Response> {
  return withBackofficeAuth(req, async (bo) => {
    requireOrganizationPermission(
      { role: bo.platformRole, organizationId: bo.organizationId },
      permission,
    );
    return handler({
      userId:         bo.userId,
      // No group, and that is the point. '' is the sentinel
      // app_current_group_id() already reads as "no group"
      // (NULLIF(current_setting(...), '')::uuid), so group-scoped RLS matches
      // nothing — correct for an organization coordinator. TenantContext
      // keeps groupId required so no group-scoped service loses that
      // guarantee; this tree simply never reads it.
      groupId:        '',
      role:           bo.platformRole,
      organizationId: bo.organizationId,
    });
  });
}

export { requireRole, requireOneOf, ForbiddenError };
