/**
 * Super-admin corrections to a group's profile and a member's details.
 *
 * Until now a super_admin could change a group's STATUS and nothing else —
 * there was no way anywhere in the product to fix a typo in a group's name or
 * a member's name, which is what this exists for.
 *
 * The three things worth pinning are the ones that are easy to get wrong:
 *
 *  - A group rename can COLLIDE (uq_group_name_per_county) and must answer
 *    409, not surface a raw constraint violation as a 500.
 *  - A member's name also lives on `person`, the cross-group identity record.
 *    Updating only `members` leaves the same human showing the old name in
 *    every OTHER group they belong to — the correction would look applied and
 *    silently not be.
 *  - PHONE IS NOT EDITABLE. It is the login identity and is UNIQUE
 *    platform-wide, so changing it changes who can sign in. The schema is
 *    strict() so sending it is a clean 400, never a silent no-op.
 */
import { PATCH as groupPatch } from '@/app/api/admin/groups/[id]/route';
import { PATCH as memberPatch } from '@/app/api/admin/groups/[id]/members/[memberId]/route';
import { backofficeHeaders, buildRequest } from './helpers/request';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

const SUPER = { userId: '', platformRole: 'super_admin' as const };

function asSuperAdmin(userId: string) {
  return backofficeHeaders({ ...SUPER, userId });
}

describe('super_admin edits a group profile', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await resetDatabase(); });

  it('renames a group and records the before/after in audit_logs', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');
    const [{ name: before }] = await rawQuery<{ name: string }>(
      `SELECT name FROM groups WHERE id = $1`, [groupId],
    );

    const res = await groupPatch(
      buildRequest(`/api/admin/groups/${groupId}`, {
        method: 'PATCH',
        headers: asSuperAdmin(officerId),
        body: { name: 'Corrected Group Name' },
      }),
      { params: Promise.resolve({ id: groupId }) },
    );
    expect(res.status).toBe(200);

    const [row] = await rawQuery<{ name: string }>(`SELECT name FROM groups WHERE id = $1`, [groupId]);
    expect(row.name).toBe('Corrected Group Name');

    const [audit] = await rawQuery<{ action: string; old_values: { name: string }; new_values: { name: string } }>(
      `SELECT action, old_values, new_values FROM audit_logs
       WHERE group_id = $1 AND action = 'group.profile_update'`,
      [groupId],
    );
    expect(audit.action).toBe('group.profile_update');
    expect(audit.old_values.name).toBe(before);
    expect(audit.new_values.name).toBe('Corrected Group Name');
  });

  it('answers 409, not 500, when the new name collides in the same county', async () => {
    const a = await createTestGroup('chairperson');
    const b = await createTestGroup('chairperson');

    // Put both in the same county so uq_group_name_per_county can bite.
    const [{ id: countyId }] = await rawQuery<{ id: string }>(`SELECT id FROM counties LIMIT 1`);
    const [{ name: countyName }] = await rawQuery<{ name: string }>(
      `SELECT name FROM counties WHERE id = $1`, [countyId],
    );
    await rawQuery(
      `UPDATE groups SET county_id = $2, county = $3 WHERE id = ANY($1::uuid[])`,
      [[a.groupId, b.groupId], countyId, countyName],
    );
    await rawQuery(`UPDATE groups SET name = 'Taken Name' WHERE id = $1`, [a.groupId]);

    const res = await groupPatch(
      buildRequest(`/api/admin/groups/${b.groupId}`, {
        method: 'PATCH',
        headers: asSuperAdmin(b.officerId),
        body: { name: 'Taken Name' },
      }),
      { params: Promise.resolve({ id: b.groupId }) },
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(String(body.error)).toMatch(/already uses that name/i);
  });

  it('still performs a status transition when given { action } — the two branches coexist', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');

    const res = await groupPatch(
      buildRequest(`/api/admin/groups/${groupId}`, {
        method: 'PATCH',
        headers: asSuperAdmin(officerId),
        body: { action: 'suspend', reason: 'testing' },
      }),
      { params: Promise.resolve({ id: groupId }) },
    );
    expect(res.status).toBe(200);

    const [row] = await rawQuery<{ onboarding_status: string }>(
      `SELECT onboarding_status FROM groups WHERE id = $1`, [groupId],
    );
    expect(row.onboarding_status).toBe('suspended');
  });
});

describe('super_admin edits a member', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await resetDatabase(); });

  it('renames a member AND propagates the name to the cross-group person record', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');

    const res = await memberPatch(
      buildRequest(`/api/admin/groups/${groupId}/members/${officerId}`, {
        method: 'PATCH',
        headers: asSuperAdmin(officerId),
        body: { firstName: 'Corrected', lastName: 'Spelling' },
      }),
      { params: Promise.resolve({ id: groupId, memberId: officerId }) },
    );
    expect(res.status).toBe(200);

    const [member] = await rawQuery<{ first_name: string; last_name: string }>(
      `SELECT first_name, last_name FROM members WHERE id = $1`, [officerId],
    );
    expect(member.first_name).toBe('Corrected');
    expect(member.last_name).toBe('Spelling');

    // The point of the test: `person` must not be left holding the old name,
    // or the member reads correctly here and wrongly in every other group.
    const [person] = await rawQuery<{ full_name: string }>(
      `SELECT p.full_name FROM person p
       JOIN group_members gm ON gm.person_id = p.id
       WHERE gm.member_id = $1`,
      [officerId],
    );
    expect(person.full_name).toBe('Corrected Spelling');
  });

  it('answers 409 when the new email is already taken by another member', async () => {
    const a = await createTestGroup('chairperson');
    const b = await createTestGroup('chairperson');
    await rawQuery(`UPDATE members SET email = 'taken@example.com' WHERE id = $1`, [a.officerId]);

    const res = await memberPatch(
      buildRequest(`/api/admin/groups/${b.groupId}/members/${b.officerId}`, {
        method: 'PATCH',
        headers: asSuperAdmin(b.officerId),
        body: { email: 'taken@example.com' },
      }),
      { params: Promise.resolve({ id: b.groupId, memberId: b.officerId }) },
    );

    expect(res.status).toBe(409);
  });

  it('REFUSES a phone change outright — phone is the login identity', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');
    const [{ phone: before }] = await rawQuery<{ phone: string }>(
      `SELECT phone FROM members WHERE id = $1`, [officerId],
    );

    const res = await memberPatch(
      buildRequest(`/api/admin/groups/${groupId}/members/${officerId}`, {
        method: 'PATCH',
        headers: asSuperAdmin(officerId),
        body: { firstName: 'Fine', phone: '254700000001' },
      }),
      { params: Promise.resolve({ id: groupId, memberId: officerId }) },
    );

    // A clean 400 from the strict schema — never a silent partial apply.
    expect(res.status).toBe(400);

    const [after] = await rawQuery<{ phone: string; first_name: string }>(
      `SELECT phone, first_name FROM members WHERE id = $1`, [officerId],
    );
    expect(after.phone).toBe(before);
    // And the rest of the payload must NOT have been applied either.
    expect(after.first_name).not.toBe('Fine');
  });

  it('denies a support-role caller — support is read-only on the admin surface', async () => {
    const { groupId, officerId } = await createTestGroup('chairperson');

    const res = await memberPatch(
      buildRequest(`/api/admin/groups/${groupId}/members/${officerId}`, {
        method: 'PATCH',
        headers: backofficeHeaders({ userId: officerId, platformRole: 'support' }),
        body: { firstName: 'Nope' },
      }),
      { params: Promise.resolve({ id: groupId, memberId: officerId }) },
    );
    expect(res.status).toBe(403);
  });
});
