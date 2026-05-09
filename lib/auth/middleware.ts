import { NextRequest } from 'next/server';
import { UnauthorizedError, ForbiddenError } from '@/lib/utils/errors';
import { handleError } from '@/lib/utils/response';
import type { AuthContext } from '@/types/api.types';
import type { MemberRole, PlatformRole } from '@/types/enums';
import { requireRole, requireOneOf } from './rbac';

/**
 * Extract the AuthContext that the edge middleware stamped onto request headers.
 * Throws UnauthorizedError if the headers are missing (request bypassed middleware).
 */
export function getAuthContext(req: NextRequest): AuthContext {
  const userId  = req.headers.get('x-user-id');
  const groupId = req.headers.get('x-group-id');
  const role    = req.headers.get('x-role') as MemberRole | PlatformRole | null;
  const ngoId   = req.headers.get('x-ngo-id') ?? undefined;

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

/**
 * withAuth variant that also enforces a minimum role before calling the handler.
 */
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

/**
 * withAuth variant that enforces one-of-many allowed roles.
 */
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

export { requireRole, requireOneOf, ForbiddenError };
