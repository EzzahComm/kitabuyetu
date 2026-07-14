export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { verifyRefreshToken, signAccessToken, hashToken } from '@/lib/auth/jwt';
import { getRefreshToken } from '@/lib/redis';
import { RefreshSchema } from '@/lib/validators/auth.schema';
import { ok, handleError, errorResponse } from '@/lib/utils/response';

interface MembershipRow {
  id:            string;
  platform_role: string;
  group_id:      string;
  role:          string;
  person_id:     string;
  group_status:  string;
}

/**
 * Refresh an access token.
 *
 * Active-membership pinning (audit C-1): the refresh token carries the groupId
 * the user chose at login. This route REVALIDATES that exact membership — it
 * must never re-derive a group (the old `ORDER BY gm.joined_at DESC LIMIT 1`
 * silently switched multi-group users to a different group mid-session, which
 * cross-posted transactions).
 *
 * Legacy refresh tokens (issued before the groupId claim existed) are honoured
 * only when the member has exactly one active membership; otherwise the client
 * must re-authenticate and pick a group.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body  = await req.json();
    const input = RefreshSchema.parse(body);

    let payload;
    try {
      payload = verifyRefreshToken(input.refreshToken);
    } catch {
      return errorResponse('Invalid or expired refresh token', 'INVALID_TOKEN', 401);
    }

    // Backoffice sessions have their own login flow and a deliberately short
    // refresh TTL; they must not be minted tenant tokens here.
    if (payload.aud === 'backoffice') {
      return errorResponse('Backoffice sessions cannot be refreshed on this endpoint', 'WRONG_AUDIENCE', 403);
    }

    const tokenHash = hashToken(input.refreshToken);
    const stored    = await getRefreshToken(tokenHash);
    if (!stored || stored !== payload.sub) {
      return errorResponse('Refresh token revoked or not found', 'TOKEN_REVOKED', 401);
    }

    // Revalidate the pinned membership. gm.status (not the stale is_active
    // boolean) is the single liveness signal (audit C-2), and the group must
    // still be operational — mirrors the login query exactly.
    const memberships = await withAdminDb(async (client) => {
      const { rows } = await client.query<MembershipRow>(
        `SELECT m.id, m.platform_role,
                gm.group_id, gm.role, gm.person_id,
                g.status AS group_status
         FROM members m
         JOIN group_members gm ON gm.member_id = m.id AND gm.status = 'active'
         JOIN groups g         ON g.id = gm.group_id
                               AND g.status NOT IN ('suspended','archived')
         WHERE m.id = $1 AND m.is_active = true
           ${payload.groupId ? 'AND gm.group_id = $2' : ''}
         ORDER BY g.created_at`,
        payload.groupId ? [payload.sub, payload.groupId] : [payload.sub],
      );
      return rows;
    });

    let membership: MembershipRow | undefined;
    if (payload.groupId) {
      // Pinned token: the chosen membership must still be valid — no fallback
      // to a different group under any circumstances.
      membership = memberships[0];
    } else if (memberships.length === 1) {
      // Legacy token without a pinned group: unambiguous, safe to honour.
      membership = memberships[0];
    }

    if (!membership) {
      return errorResponse(
        'Your session\'s group membership is no longer active. Please sign in again.',
        'NO_ACTIVE_GROUP',
        403,
      );
    }

    // Role is re-read from the membership row so promotions/demotions
    // propagate at refresh time. Platform super_admin overrides, as at login.
    const role = membership.platform_role === 'super_admin' ? 'super_admin' : membership.role;

    const accessToken = signAccessToken({
      sub:         membership.id,
      groupId:     membership.group_id,
      role:        role as any,
      personId:    membership.person_id,
      groupStatus: membership.group_status,
    });

    return ok({ accessToken });
  } catch (err) {
    return handleError(err);
  }
}
