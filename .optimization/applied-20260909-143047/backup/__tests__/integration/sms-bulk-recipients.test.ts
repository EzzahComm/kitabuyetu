/**
 * Who "Send to All Members" actually reaches, against real Postgres.
 *
 * The bug this pins: ComposeTab built the recipient list in the browser from
 * `useMembers({ pageSize: 500 })`. `MemberQuerySchema` has no `pageSize` — only
 * `limit`, default 20, max 100 — so Zod stripped the key and the list came back
 * with 20 rows. Every group larger than that silently reached its first 20
 * members and the UI reported a successful send.
 *
 * Nothing caught it because no layer was wrong on its own: the query was valid,
 * the response was valid, the send was valid. Only the number was wrong, and no
 * assertion anywhere named the number. So this file uses a group of 25 — bigger
 * than the old cap, small enough to build quickly — and asserts the count.
 *
 * See docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §3.1.
 */
import { POST as bulkPost } from '@/app/api/v1/sms/bulk/route';
import { buildRequest, authHeaders } from './helpers/request';
import { createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { __resetSubscriptionCache } from '@/lib/auth/subscription-gate';

// There is no Redis in the integration environment, so the real limiter has to
// let its fetch fail before every send. It fails open (that is its production
// behaviour during an outage, by design) but not quickly — the wait dominated
// this suite's runtime. Stubbing it returns the same answer sooner; what this
// file is about is who gets the message, not how many sends a group may make.
jest.mock('@/lib/sms/rate-limit', () => ({
  enforceSmsRateLimit: jest.fn().mockResolvedValue(null),
}));

const MESSAGE = 'Meeting on Saturday at 10am.';

/** Bigger than MemberQuerySchema's old default of 20 — that gap is the test. */
const GROUP_SIZE = 25;

function send(groupId: string, officerId: string, body: unknown) {
  return bulkPost(buildRequest('/api/v1/sms/bulk', {
    method: 'POST',
    headers: authHeaders({
      userId: officerId, groupId, role: 'chairperson',
      permissions: ['messaging.send', 'members.view'],
    }),
    body,
  }));
}

async function queuedCount(res: Response): Promise<number> {
  const body = await res.json() as { data?: { queued?: number } };
  return body.data?.queued ?? -1;
}

describe('POST /sms/bulk recipient resolution', () => {
  let groupId: string;
  let officerId: string;

  // Built ONCE, not per test. Standing up 25 members through the real member
  // service costs about a minute; doing it six times would add ~7 minutes to
  // the integration job to re-prove a fixture. Every test below either only
  // reads membership or restores what it changed in afterEach.
  beforeAll(async () => {
    await resetDatabase();
    __resetSubscriptionCache();

    ({ groupId, officerId } = await createTestGroup('chairperson'));
    // register_group creates the officer as member #1.
    for (let i = 1; i < GROUP_SIZE; i++) {
      await addGroupOfficer(groupId, officerId, 'member');
    }
  });

  afterEach(async () => {
    await rawQuery(`UPDATE group_members SET is_active = true WHERE group_id = $1`, [groupId]);
  });

  it('reaches every member, not the first page of them', async () => {
    const res = await send(groupId, officerId, { recipientType: 'all_members', message: MESSAGE });

    expect(res.status).toBe(200);
    // The assertion that matters. Before the fix this was 20 for any group
    // this size, and the old client had no way to ask for more than 100.
    expect(await queuedCount(res)).toBe(GROUP_SIZE);
  });

  it('excludes inactive memberships when asked for active members only', async () => {
    await rawQuery(
      `UPDATE group_members SET is_active = false
       WHERE ctid IN (SELECT ctid FROM group_members WHERE group_id = $1 AND is_active LIMIT 3)`,
      [groupId],
    );

    const all    = await send(groupId, officerId, { recipientType: 'all_members', message: MESSAGE });
    const active = await send(groupId, officerId, { recipientType: 'active_members', message: MESSAGE });

    expect(await queuedCount(all)).toBe(GROUP_SIZE);
    expect(await queuedCount(active)).toBe(GROUP_SIZE - 3);
  });

  it('still sends exactly the numbers a human typed', async () => {
    const res = await send(groupId, officerId, {
      phones: ['254712345678', '254798765432'], message: MESSAGE,
    });

    expect(res.status).toBe(200);
    expect(await queuedCount(res)).toBe(2);
  });

  it('refuses an audience that resolves to nobody instead of reporting success', async () => {
    await rawQuery(`UPDATE group_members SET is_active = false WHERE group_id = $1`, [groupId]);

    const res = await send(groupId, officerId, { recipientType: 'active_members', message: MESSAGE });

    expect(res.status).toBe(422);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('refuses a request that names both an audience and a phone list', async () => {
    const res = await send(groupId, officerId, {
      recipientType: 'all_members', phones: ['254712345678'], message: MESSAGE,
    });

    expect(res.status).toBe(422);
  });

  it('resolves against the calling group only', async () => {
    // The phones come from the token's group, never from the request body — so
    // one group's send can never sweep in another's members. With 25 sitting in
    // the neighbouring group, a leak would be unmissable.
    const other = await createTestGroup('chairperson');
    await addGroupOfficer(other.groupId, other.officerId, 'member');

    const res = await send(other.groupId, other.officerId, {
      recipientType: 'all_members', message: MESSAGE,
    });

    expect(await queuedCount(res)).toBe(2);
  });
});
