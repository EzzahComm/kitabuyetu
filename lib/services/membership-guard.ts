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
import { ValidationError } from '@/lib/utils/errors';

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
