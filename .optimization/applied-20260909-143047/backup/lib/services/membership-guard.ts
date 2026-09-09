/**
 * Centralized membership validation for financial write paths (audit H-1).
 *
 * Every operation that records money against a member MUST prove the member
 * holds a membership in the target group before writing the row. RLS scopes
 * rows by group_id but never checks member_id, so without this guard a
 * treasurer (or a buggy client) can post a transaction in their group against
 * a member who only belongs to another group — cross-group pollution.
 *
 * Status semantics follow the membership state machine (payment architecture
 * §4): only 'active' memberships accept financial postings by default.
 * Callers with a documented reason to include other states (e.g. dividends
 * paid to 'exited' members during share-out) pass `allowStatuses` explicitly.
 *
 * The returned membershipId is the group_members.id the caller should stamp
 * on the transaction row once attribution columns exist (Phase 3) —
 * validation and attribution are the same act.
 */
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { ValidationError, UnauthorizedError } from '@/lib/utils/errors';
import type { AuthContext } from '@/types/api.types';

export interface MembershipRef {
  membershipId: string;
  memberCode:   string;
}

export async function assertActiveMembership(
  client:   PoolClient,
  groupId:  string,
  memberId: string,
  opts?: { allowStatuses?: string[] },
): Promise<MembershipRef> {
  const statuses = opts?.allowStatuses ?? ['active'];
  const { rows } = await client.query<{ id: string; member_code: string }>(
    `SELECT id, member_code
     FROM   group_members
     WHERE  group_id = $1 AND member_id = $2 AND status = ANY($3::member_status[])`,
    [groupId, memberId, statuses],
  );
  if (!rows[0]) {
    throw new ValidationError(
      `Member ${memberId} has no ${statuses.join('/')} membership in this group`,
    );
  }
  return { membershipId: rows[0].id, memberCode: rows[0].member_code };
}

/**
 * Sensitive-operation epoch re-check (payment architecture §2.5).
 *
 * Access tokens carry authVersion (membership role/status epoch) and
 * sessionVersion (member-level epoch). Non-sensitive endpoints accept drift
 * up to the token TTL; sensitive operations — loan approval/disbursement,
 * B2C payouts, reversals, unrouted allocation, member-status changes — call
 * this to compare the token's epochs against current database truth, so a
 * demoted/blacklisted actor cannot ride a stale token through a money-moving
 * or governance action.
 *
 * Legacy tokens without epoch claims skip the comparison (drift bounded by
 * the 15-minute access TTL; those tokens age out on their own).
 *
 * RBAC permission activation (SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4):
 * also returns the CALLER'S LIVE roles.permissions (via group_members.role_id,
 * the same join login/refresh use), so callers at these 8 sites can re-verify
 * the specific permission string against current truth instead of trusting
 * the JWT's (bounded-stale) permissions claim — closing the staleness window
 * to zero for exactly the routes that already pay this DB round-trip's cost,
 * without adding a live lookup to the other 100+ withPermission call sites.
 */
export async function assertAuthFresh(auth: AuthContext): Promise<string[] | undefined> {
  if (auth.authVersion == null && auth.sessionVersion == null) return auth.permissions;

  const row = await withAdminDb(async (client) => {
    const { rows } = await client.query<{
      session_version: number; auth_version: number | null; permissions: string[] | null;
    }>(
      `SELECT m.session_version, gm.auth_version, r.permissions
       FROM   members m
       LEFT JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $2
       LEFT JOIN roles r          ON r.id = gm.role_id
       WHERE  m.id = $1`,
      [auth.userId, auth.groupId],
    );
    return rows[0];
  });

  if (!row) {
    throw new UnauthorizedError('Session out of date. Please sign in again.');
  }
  if (auth.sessionVersion != null && row.session_version !== auth.sessionVersion) {
    throw new UnauthorizedError('Session out of date. Please sign in again.');
  }
  if (auth.authVersion != null && row.auth_version != null && row.auth_version !== auth.authVersion) {
    throw new UnauthorizedError('Your role or membership changed. Please sign in again.');
  }
  return row.permissions ?? auth.permissions;
}
