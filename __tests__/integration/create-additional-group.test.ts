/**
 * POST /api/v1/auth/create-group — against real Postgres.
 *
 * The fix for a real gap: members.phone is UNIQUE platform-wide, and
 * register_group() (the public /register RPC) always INSERTs a fresh members
 * row — so an existing member trying to found a SECOND group (e.g. already
 * has Kitabu Yetu, wants to also start Chama Reminder) got a dead-end
 * "Phone number already registered" 409. group_members already fully
 * supports one member_id belonging to many groups (group-switcher.tsx /
 * switch-group prove that daily) — what was missing was a way to CREATE that
 * second membership. This is that path: authenticated, reuses the caller's
 * existing member_id/person_id, never touches members or person.
 *
 * Covers both directions (Kitabu Yetu -> Chama Reminder and back) since the
 * chart-of-accounts seed is the one place behavior genuinely forks by
 * product, and asserts the identity-reuse property directly — the entire
 * point of this feature over the public register form.
 */
import { POST as createGroupPost } from '@/app/api/v1/auth/create-group/route';
import { authHeaders, buildRequest } from './helpers/request';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

// The route's non-fatal refresh-token persistence calls storeRefreshToken
// (lib/redis), which — unlike checkRateLimit — has no fail-open try/catch of
// its own; in an environment with no real Redis reachable (this sandbox,
// apparently CI too) it doesn't fail fast, it just hangs past any reasonable
// per-test timeout. Same established pattern as
// permissions/auth-version-bump.test.ts for exactly this reason.
jest.mock('@/lib/redis', () => ({
  storeRefreshToken: jest.fn().mockResolvedValue(undefined),
}));

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

async function countyId(): Promise<string> {
  const [row] = await rawQuery<{ id: string }>(`SELECT id FROM counties LIMIT 1`);
  return row.id;
}

describe('POST /api/v1/auth/create-group', () => {
  afterAll(async () => {
    await resetDatabase();
  });

  it('founds a second (Chama Reminder) group for an existing Kitabu Yetu member, reusing their identity', async () => {
    await resetDatabase();
    const { groupId: firstGroupId, officerId } = await createTestGroup('chairperson', { product: 'kitabu_yetu' });
    const chairpersonPerms = await permissionsFor('chairperson');
    const county = await countyId();

    const [firstPersonRow] = await rawQuery<{ person_id: string }>(
      `SELECT person_id FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [firstGroupId, officerId],
    );

    const res = await createGroupPost(buildRequest('/api/v1/auth/create-group', {
      method: 'POST',
      headers: authHeaders({ userId: officerId, groupId: firstGroupId, role: 'chairperson', permissions: chairpersonPerms }),
      body: {
        product: 'chama_reminder',
        groupName: 'Reminder Offshoot',
        groupType: 'chama',
        creatorRole: 'chairperson',
        countyId: county,
      },
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    const newGroupId = body.data.member.groupId;
    expect(newGroupId).not.toBe(firstGroupId);
    expect(body.data.signupProduct).toBe('chama_reminder');
    // Same login identity carried the request end to end.
    expect(body.data.member.id).toBe(officerId);
    expect(body.data.member.phone).toBeTruthy();

    // No new members or person row — the entire point.
    const [memberCount] = await rawQuery<{ count: string }>(
      `SELECT count(*) AS count FROM members WHERE id = $1`, [officerId],
    );
    expect(memberCount.count).toBe('1');

    const [newMembership] = await rawQuery<{ person_id: string; role: string; status: string }>(
      `SELECT person_id, role, status FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [newGroupId, officerId],
    );
    expect(newMembership.person_id).toBe(firstPersonRow.person_id);
    expect(newMembership.role).toBe('chairperson');
    expect(newMembership.status).toBe('active');

    const [officer] = await rawQuery<{ role: string }>(
      `SELECT role FROM group_officers WHERE group_id = $1 AND member_id = $2`,
      [newGroupId, officerId],
    );
    expect(officer.role).toBe('chairperson');

    const [billing] = await rawQuery<{ count: string }>(
      `SELECT count(*) AS count FROM billing_accounts WHERE group_id = $1`, [newGroupId],
    );
    expect(billing.count).toBe('1');

    // chama_reminder gets no chart of accounts (migration 140's convention).
    const [accounts] = await rawQuery<{ count: string }>(
      `SELECT count(*) AS count FROM accounts WHERE group_id = $1`, [newGroupId],
    );
    expect(accounts.count).toBe('0');

    // The original group and membership are completely untouched.
    const [firstStillActive] = await rawQuery<{ status: string }>(
      `SELECT status FROM group_members WHERE group_id = $1 AND member_id = $2`,
      [firstGroupId, officerId],
    );
    expect(firstStillActive.status).toBe('active');
  });

  it('founds a Kitabu Yetu group for an existing Chama Reminder member, seeding a real chart of accounts', async () => {
    await resetDatabase();
    const { groupId: firstGroupId, officerId } = await createTestGroup('treasurer', { product: 'chama_reminder' });
    const treasurerPerms = await permissionsFor('treasurer');
    const county = await countyId();

    const res = await createGroupPost(buildRequest('/api/v1/auth/create-group', {
      method: 'POST',
      headers: authHeaders({ userId: officerId, groupId: firstGroupId, role: 'treasurer', permissions: treasurerPerms }),
      body: {
        product: 'kitabu_yetu',
        groupName: 'Full Books Group',
        groupType: 'sacco',
        creatorRole: 'treasurer',
        countyId: county,
      },
    }));

    expect(res.status).toBe(201);
    const body = await res.json();
    const newGroupId = body.data.member.groupId;
    expect(body.data.signupProduct).toBe('kitabu_yetu');

    const [accounts] = await rawQuery<{ count: string }>(
      `SELECT count(*) AS count FROM accounts WHERE group_id = $1`, [newGroupId],
    );
    expect(Number(accounts.count)).toBeGreaterThan(0);
  });

  it('rejects a colliding group name in the same county with a clean 4xx, not a raw 500', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    const chairpersonPerms = await permissionsFor('chairperson');
    const county = await countyId();

    const payload = {
      product: 'kitabu_yetu', groupName: 'Duplicate Name Test', groupType: 'chama',
      creatorRole: 'chairperson', countyId: county,
    };
    const first = await createGroupPost(buildRequest('/api/v1/auth/create-group', {
      method: 'POST',
      headers: authHeaders({ userId: officerId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      body: payload,
    }));
    expect(first.status).toBe(201);

    const second = await createGroupPost(buildRequest('/api/v1/auth/create-group', {
      method: 'POST',
      headers: authHeaders({ userId: officerId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
      body: payload,
    }));
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(second.status).toBeLessThan(500);
  });
});
