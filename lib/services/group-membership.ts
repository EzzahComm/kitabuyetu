/**
 * Shared helper for linking a member to a group.
 *
 * Mirrors the logic the register_group() PL/pgSQL RPC uses for the
 * creator's first group_members row (mig 030/032/034). Without this,
 * every non-RPC path that tries to add someone to a group fails NOT NULL
 * on group_members.person_id / member_code (both required since mig 030).
 *
 * Callers MUST already be inside an open transaction (`client` parameter)
 * so the person upsert, counter allocation, and group_members insert all
 * commit/rollback atomically. The actual writes happen inside
 * public.link_member_to_group() (migration 098), a SECURITY DEFINER
 * function — person/group_member_counters were deliberately built (mig 030)
 * with no INSERT/UPDATE policy for any tenant role ("service-role writes
 * only"; person is genuinely cross-group, so there's no group_id to scope a
 * real policy on), and this helper is called from real tenant-context
 * requests (membersService.create(), CSV bulk import). Running the writes
 * inside a SECURITY DEFINER function keeps that original trust boundary
 * intact regardless of which role the caller's `client` connects as — see
 * docs/adr/001-bypassrls-two-role-split.md.
 */
import type { PoolClient } from 'pg';
import { DatabaseError } from 'pg';
import { ConflictError, NotFoundError } from '@/lib/utils/errors';

export interface LinkMemberInput {
  /** Existing platform-level members.id (already INSERTed elsewhere). */
  memberId:     string;
  /** Group to add them to. */
  groupId:      string;
  /** member_role enum. */
  role:         string;
  /** ISO YYYY-MM-DD; omit to use CURRENT_DATE. */
  joinedAt?:    string | null;
  /** members.id of the actor recording this. Optional. */
  invitedBy?:   string | null;
  /** Profile fields used to build/find the cross-group person row. */
  firstName:    string;
  lastName:     string;
  phone?:       string | null;
  nationalId?:  string | null;
  /** ISO YYYY-MM-DD; falls back to 1970-01-01 placeholder if missing
   * (matches the RPC's behaviour for MVP onboarding without KYC). */
  dateOfBirth?: string | null;
  gender?:      string | null;
}

export interface LinkMemberResult {
  groupMembersId: string;
  memberCode:     string;
  /** The Membership Number (BG102534…) — allocated by the DB trigger at INSERT. */
  membershipNo:   string;
  personId:       string;
}

export async function linkMemberToGroup(
  client: PoolClient,
  input:  LinkMemberInput,
): Promise<LinkMemberResult> {
  try {
    const { rows } = await client.query<{
      group_members_id: string;
      member_code:      string;
      membership_no:    string;
      person_id:        string;
    }>(
      `SELECT * FROM link_member_to_group(
         $1, $2, $3::member_role, $4, $5, $6, $7, $8::date, $9::gender, $10::date, $11
       )`,
      [
        input.memberId, input.groupId, input.role,
        input.firstName, input.lastName,
        input.phone ?? null, input.nationalId ?? null,
        input.dateOfBirth ?? null, input.gender ?? null,
        input.joinedAt ?? null, input.invitedBy ?? null,
      ],
    );

    return {
      groupMembersId: rows[0].group_members_id,
      memberCode:     rows[0].member_code,
      membershipNo:   rows[0].membership_no,
      personId:       rows[0].person_id,
    };
  } catch (err) {
    // link_member_to_group() (migration 098) signals these two cases via
    // RAISE EXCEPTION ... USING ERRCODE, matching this function's original
    // pre-098 error contract so callers don't need to change.
    if (err instanceof DatabaseError && err.code === 'P0002') {
      throw new NotFoundError('Group', input.groupId);
    }
    if (err instanceof DatabaseError && err.code === '23000') {
      throw new ConflictError(`Group ${input.groupId} has no member counter row`);
    }
    throw err;
  }
}
