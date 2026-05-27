import { NextRequest } from 'next/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/utils/errors';
import { handleError } from '@/lib/utils/response';
import type { AuthContext } from '@/types/api.types';
import type { MemberRole, PlatformRole } from '@/types/enums';
import { requireRole, requireOneOf } from './rbac';

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
  const ngoId   = req.headers.get('x-ngo-id') ?? undefined;
  const aud     = req.headers.get('x-aud');

  if (aud === 'backoffice') {
    throw new ForbiddenError('Backoffice token cannot be used on tenant routes');
  }
  if (!userId || !groupId || !role) {
    throw new UnauthorizedError('Missing authentication context');
  }

  return { userId, groupId, role, ngoId };
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
    return handler(auth, ...args).catch(handleError);
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

// ─── Backoffice (platform staff) context ───────────────────────────────

export type AdminPlatformRole = Exclude<PlatformRole, 'member'>;

export interface BackofficeContext {
  userId:       string;
  platformRole: AdminPlatformRole;
  ngoId?:       string;
}

/**
 * Extract the backoffice-staff context the proxy stamped for an admin request.
 * Use this in /api/admin/* routes; the proxy already enforces that the token
 * has `aud: 'backoffice'` before stamping these headers.
 */
export function getBackofficeContext(req: NextRequest): BackofficeContext {
  const userId       = req.headers.get('x-user-id');
  const platformRole = req.headers.get('x-platform-role') as AdminPlatformRole | null;
  const ngoId        = req.headers.get('x-ngo-id') ?? undefined;
  const aud          = req.headers.get('x-aud');

  if (aud !== 'backoffice') {
    throw new ForbiddenError('Tenant token cannot be used on backoffice routes');
  }
  if (!userId || !platformRole) {
    throw new UnauthorizedError('Missing backoffice authentication context');
  }
  if (platformRole !== 'super_admin' && platformRole !== 'support' && platformRole !== 'ngo_coordinator') {
    throw new ForbiddenError(`Role '${platformRole}' is not a valid backoffice role`);
  }
  return { userId, platformRole, ngoId };
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

export { requireRole, requireOneOf, ForbiddenError };
