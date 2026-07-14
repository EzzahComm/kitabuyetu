export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import {
  verifyRefreshToken, signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds,
} from '@/lib/auth/jwt';
import { storeRefreshToken, revokeRefreshToken } from '@/lib/redis';
import { RefreshSchema } from '@/lib/validators/auth.schema';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import { logger } from '@/lib/logger';

interface MembershipRow {
  id:              string;    // members.id
  platform_role:   string;
  session_version: number;
  membership_id:   string;    // group_members.id
  group_id:        string;
  role:            string;
  auth_version:    number;
  person_id:       string;
  membership_no:   string;
  group_status:    string;
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
 * Rotation with reuse detection (§15.3, ADR-25): each refresh CONSUMES the
 * presented token and issues a successor in the same lineage. A consumed
 * token presented again is treated as replay — the entire lineage is revoked,
 * so a stolen refresh token dies at the first legitimate refresh after theft.
 *
 * Epoch checks (§2.5): members.session_version is compared against the value
 * captured at issue; a mismatch (password change, "log out everywhere",
 * blacklist) terminates the session. group_members.auth_version and role are
 * re-read from current truth on every refresh, so role drift never survives
 * a token renewal.
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

    // ── Consume the token (rotation latch) ─────────────────────────────────
    // The refresh_tokens table is the rotation source of truth: exactly one
    // caller can consume a given token. Redis remains the fast revocation
    // cache but no longer gates the happy path (it can't represent lineage).
    const consumed = await withAdminDb(async (client) => {
      const { rows } = await client.query<{ lineage_id: string; membership_id: string | null }>(
        `UPDATE refresh_tokens
         SET    consumed_at = NOW()
         WHERE  token_hash = $1 AND member_id = $2
           AND  consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
         RETURNING lineage_id, membership_id`,
        [tokenHash, payload.sub],
      );
      if (rows[0]) return { kind: 'ok' as const, ...rows[0] };

      // Not consumable — distinguish replay (consumed/revoked row exists)
      // from plain unknown/expired.
      const { rows: prior } = await client.query<{ lineage_id: string; consumed_at: Date | null }>(
        `SELECT lineage_id, consumed_at FROM refresh_tokens
         WHERE  token_hash = $1 AND member_id = $2`,
        [tokenHash, payload.sub],
      );
      if (prior[0]?.consumed_at) {
        // Replay of a consumed token → revoke the whole lineage (§15.3).
        await client.query(
          `UPDATE refresh_tokens SET revoked_at = NOW()
           WHERE  lineage_id = $1 AND revoked_at IS NULL`,
          [prior[0].lineage_id],
        );
        return { kind: 'replay' as const, lineage_id: prior[0].lineage_id };
      }
      return { kind: 'unknown' as const };
    });

    if (consumed.kind === 'replay') {
      logger.warn('[auth/refresh] consumed refresh token replayed — lineage revoked', {
        memberId: payload.sub, lineageId: consumed.lineage_id,
      });
      await revokeRefreshToken(tokenHash).catch(() => {});
      return errorResponse('Session revoked. Please sign in again.', 'TOKEN_REVOKED', 401);
    }
    if (consumed.kind === 'unknown') {
      return errorResponse('Refresh token revoked or not found', 'TOKEN_REVOKED', 401);
    }

    // Revalidate the pinned membership. gm.status (not the stale is_active
    // boolean) is the single liveness signal (audit C-2), and the group must
    // still be operational — mirrors the login query exactly.
    const memberships = await withAdminDb(async (client) => {
      const { rows } = await client.query<MembershipRow>(
        `SELECT m.id, m.platform_role, m.session_version,
                gm.id AS membership_id, gm.group_id, gm.role, gm.auth_version,
                gm.person_id, gm.membership_no,
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

    // ── Session epoch (§2.5) ────────────────────────────────────────────────
    // A bump since issue (password change, log-out-everywhere, blacklist)
    // terminates the whole lineage, not just this request.
    if (payload.sessionVersion != null && payload.sessionVersion !== membership.session_version) {
      await withAdminDb((client) =>
        client.query(
          `UPDATE refresh_tokens SET revoked_at = NOW()
           WHERE  lineage_id = $1 AND revoked_at IS NULL`,
          [consumed.lineage_id],
        ),
      );
      await revokeRefreshToken(tokenHash).catch(() => {});
      return errorResponse('Session terminated. Please sign in again.', 'SESSION_TERMINATED', 401);
    }

    // Role is re-read from the membership row so promotions/demotions
    // propagate at refresh time. Platform super_admin overrides, as at login.
    const role = membership.platform_role === 'super_admin' ? 'super_admin' : membership.role;

    const accessToken = signAccessToken({
      sub:            membership.id,
      groupId:        membership.group_id,
      role:           role as any,
      personId:       membership.person_id,
      groupStatus:    membership.group_status,
      membershipId:   membership.membership_id,
      membershipNo:   membership.membership_no,
      authVersion:    membership.auth_version,
      sessionVersion: membership.session_version,
    });

    // ── Rotate: issue the successor in the same lineage ────────────────────
    const { token: nextRefreshToken } = signRefreshToken(
      membership.id, 'tenant', membership.group_id, membership.session_version,
    );
    const nextHash = hashToken(nextRefreshToken);
    await withAdminDb((client) =>
      client.query(
        `INSERT INTO refresh_tokens
           (member_id, token_hash, expires_at, ip_address, lineage_id, membership_id)
         VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4, $5, $6)`,
        [membership.id, nextHash, refreshTtlSeconds(),
         req.headers.get('x-forwarded-for') ?? null,
         consumed.lineage_id, membership.membership_id],
      ),
    );
    // Redis: best-effort cache swap (revocation fast path only).
    await storeRefreshToken(nextHash, membership.id, refreshTtlSeconds()).catch(() => {});
    await revokeRefreshToken(tokenHash).catch(() => {});

    return ok({ accessToken, refreshToken: nextRefreshToken });
  } catch (err) {
    return handleError(err);
  }
}
