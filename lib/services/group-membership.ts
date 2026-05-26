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
 * commit/rollback atomically. The function locks the group_member_counters
 * row FOR UPDATE so concurrent inserts can't race on member_seq.
 */
import type { PoolClient } from 'pg';
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
  personId:       string;
}

export async function linkMemberToGroup(
  client: PoolClient,
  input:  LinkMemberInput,
): Promise<LinkMemberResult> {
  // 1. Look up the group's code — needed to build the per-member identifier.
  const { rows: g } = await client.query<{ group_code: string }>(
    `SELECT group_code FROM groups WHERE id = $1`,
    [input.groupId],
  );
  if (!g[0]) throw new NotFoundError('Group', input.groupId);

  // 2. Upsert the cross-group person identity. With a national_id, ON
  //    CONFLICT links to the existing row; without one, synthesise a
  //    placeholder so the NOT NULL + UNIQUE constraints hold.
  const fullName = `${input.firstName} ${input.lastName}`.trim();
  const dob      = input.dateOfBirth ?? '1970-01-01';

  let personId: string;
  if (input.nationalId) {
    const { rows: p } = await client.query<{ id: string }>(
      `INSERT INTO person (national_id, full_name, dob, phone, gender)
       VALUES ($1, $2, $3::date, $4, $5)
       ON CONFLICT (national_id) DO UPDATE SET
         phone     = COALESCE(person.phone, EXCLUDED.phone),
         full_name = CASE WHEN person.full_name = '' THEN EXCLUDED.full_name ELSE person.full_name END
       RETURNING id`,
      [input.nationalId, fullName, dob, input.phone ?? null, input.gender ?? null],
    );
    personId = p[0].id;
  } else {
    const { rows: p } = await client.query<{ id: string }>(
      `INSERT INTO person (national_id, full_name, dob, phone, gender)
       VALUES ('TEMP-' || gen_random_uuid()::text, $1, $2::date, $3, $4)
       RETURNING id`,
      [fullName, dob, input.phone ?? null, input.gender ?? null],
    );
    personId = p[0].id;
  }

  // 3. Allocate the per-group sequential code. UPDATE acquires the row
  //    lock; INSERT-then-UPDATE seeds the counter for legacy/dev groups
  //    that pre-date mig 030.
  const { rows: seqRows } = await client.query<{ last_seq: number }>(
    `INSERT INTO group_member_counters (group_id, last_seq)
     VALUES ($1, 0)
     ON CONFLICT (group_id) DO NOTHING`,
    [input.groupId],
  ).then(() => client.query<{ last_seq: number }>(
    `UPDATE group_member_counters
        SET last_seq = last_seq + 1
      WHERE group_id = $1
      RETURNING last_seq`,
    [input.groupId],
  ));
  if (!seqRows[0]) throw new ConflictError(`Group ${input.groupId} has no member counter row`);

  const memberCode = `${g[0].group_code}${String(seqRows[0].last_seq).padStart(5, '0')}`;

  // 4. The actual group_members link.
  const { rows: gm } = await client.query<{ id: string }>(
    `INSERT INTO group_members (
       group_id, member_id, person_id, member_code,
       role, status, joined_at, invited_by
     ) VALUES (
       $1, $2, $3, $4,
       $5::member_role, 'active'::member_status,
       COALESCE($6::date, CURRENT_DATE), $7
     )
     RETURNING id`,
    [
      input.groupId, input.memberId, personId, memberCode,
      input.role, input.joinedAt ?? null, input.invitedBy ?? null,
    ],
  );

  return { groupMembersId: gm[0].id, memberCode, personId };
}
