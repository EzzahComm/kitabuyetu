/**
 * Product-scoped entitlement (migration 140) against real Postgres.
 *
 * Migration 139 locked unpaid groups out of the product. Migration 140 added a
 * second axis: a Chama Reminder group is paying, but for a communication-only
 * product that register_group deliberately gives no chart of accounts. Asking
 * only "is this group paying for anything" would let it walk into
 * /api/v1/contributions and fail deep inside a posting template instead of at
 * the door.
 *
 * The alternative to this gate was auditing every downstream path that assumes
 * a general ledger exists — unbounded, and impossible to keep true. So the
 * boundary is enforced in one place, and this file is what proves that place
 * actually holds.
 */
import { GET as contributionsGet } from '@/app/api/v1/contributions/route';
import { GET as smsUsageGet } from '@/app/api/v1/sms/usage/route';
import { GET as membersGet } from '@/app/api/v1/members/route';
import { GET as meetingsGet } from '@/app/api/v1/meetings/route';
import { GET as entitlementsGet } from '@/app/api/v1/billing/entitlements/route';
import { buildRequest, authHeaders } from './helpers/request';
import { createTestGroup, subscribeTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { __resetSubscriptionCache } from '@/lib/auth/subscription-gate';

const PERMISSIONS = [
  'contributions.view', 'members.view', 'meetings.view',
  'messaging.view', 'messaging.send', 'billing.manage',
];

function headersFor(groupId: string, officerId: string) {
  return authHeaders({ userId: officerId, groupId, role: 'chairperson', permissions: PERMISSIONS });
}

const statusOf = {
  contributions: (g: string, o: string) =>
    contributionsGet(buildRequest('/api/v1/contributions', { headers: headersFor(g, o) })),
  smsUsage: (g: string, o: string) =>
    smsUsageGet(buildRequest('/api/v1/sms/usage', { headers: headersFor(g, o) })),
  members: (g: string, o: string) =>
    membersGet(buildRequest('/api/v1/members', { headers: headersFor(g, o) })),
  meetings: (g: string, o: string) =>
    meetingsGet(buildRequest('/api/v1/meetings', { headers: headersFor(g, o) })),
};

describe('product-scoped entitlement', () => {
  beforeEach(async () => {
    await resetDatabase();
    __resetSubscriptionCache();
  });

  describe('a Chama Reminder group', () => {
    it('is refused the financial surface, with a code distinct from "never paid"', async () => {
      const { groupId, officerId } = await createTestGroup('chairperson', { product: 'chama_reminder' });

      const res = await statusOf.contributions(groupId, officerId);
      expect(res.status).toBe(402);

      // PRODUCT_NOT_ENTITLED, not PAYMENT_REQUIRED. The two must never be
      // confusable: one means "pay us", the other means "you already do, just
      // not for this" — and the client routes them to different pages.
      const body = await res.json() as { code: string };
      expect(body.code).toBe('PRODUCT_NOT_ENTITLED');
    });

    it('reaches the surface it actually bought', async () => {
      const { groupId, officerId } = await createTestGroup('chairperson', { product: 'chama_reminder' });

      expect((await statusOf.smsUsage(groupId, officerId)).status).toBe(200);
      expect((await statusOf.members(groupId, officerId)).status).toBe(200);
    });

    it('gets no chart of accounts at registration', async () => {
      // The reason the gate above exists at all. If this ever starts returning
      // 16, the Chama Reminder signup has quietly become a Kitabu Yetu one.
      const { groupId } = await createTestGroup('chairperson', { product: 'chama_reminder' });
      const [{ count }] = await rawQuery<{ count: string }>(
        `SELECT count(*)::text AS count FROM accounts WHERE group_id = $1`, [groupId],
      );
      expect(Number(count)).toBe(0);
    });
  });

  describe('a Kitabu Yetu group', () => {
    it('reaches both its own surface and the shared one', async () => {
      const { groupId, officerId } = await createTestGroup('chairperson');

      expect((await statusOf.contributions(groupId, officerId)).status).toBe(200);
      // The shared surface is shared in BOTH directions — scoping SMS to
      // chama_reminder would have taken the SMS Centre away from every
      // existing Kitabu Yetu group.
      expect((await statusOf.smsUsage(groupId, officerId)).status).toBe(200);
    });
  });

  describe('a group holding both products', () => {
    it('reaches everything', async () => {
      const { groupId, officerId } = await createTestGroup('chairperson');
      await subscribeTestGroup(groupId, 'starter', 'chama_reminder');

      expect((await statusOf.contributions(groupId, officerId)).status).toBe(200);
      expect((await statusOf.smsUsage(groupId, officerId)).status).toBe(200);
    });
  });

  describe('a group that has never paid', () => {
    it('is refused with PAYMENT_REQUIRED, not PRODUCT_NOT_ENTITLED', async () => {
      const { groupId, officerId } = await createTestGroup('chairperson', { subscribed: false });

      const res = await statusOf.contributions(groupId, officerId);
      expect(res.status).toBe(402);
      expect((await res.json() as { code: string }).code).toBe('PAYMENT_REQUIRED');
    });

    it('is refused /members and /meetings too', async () => {
      // These were accidentally OPEN before this branch: the carve-out list
      // contains '/api/v1/me' and matching was a bare startsWith, so both
      // '/api/v1/members' and '/api/v1/meetings' matched it by raw string
      // prefix. Migration 139's lock never covered them, including POST member
      // creation. Segment-aware matching is what closed it.
      const { groupId, officerId } = await createTestGroup('chairperson', { subscribed: false });

      expect((await statusOf.members(groupId, officerId)).status).toBe(402);
      expect((await statusOf.meetings(groupId, officerId)).status).toBe(402);
    });

    it('can still read its own entitlements, so it can be sent somewhere useful', async () => {
      // /billing is outside the lock precisely so a locked group can find out
      // what it owes. entitlements lives there for the same reason: a group
      // with ZERO subscriptions must still be able to render a subscribe page.
      const { groupId, officerId } = await createTestGroup('chairperson', {
        subscribed: false, product: 'chama_reminder',
      });

      const res = await entitlementsGet(
        buildRequest('/api/v1/billing/entitlements', { headers: headersFor(groupId, officerId) }),
      );
      expect(res.status).toBe(200);

      const body = await res.json() as { data: { products: string[]; signupProduct: string } };
      expect(body.data.products).toEqual([]);
      // The only thing that can tell us where to send them. Without
      // signup_product a never-paid Chama Reminder registrant is
      // indistinguishable from an unpaid Kitabu Yetu one.
      expect(body.data.signupProduct).toBe('chama_reminder');
    });
  });

  describe('the cache', () => {
    it('never denies on stale state — buying a second product takes effect at once', async () => {
      // THE INVARIANT THIS WHOLE DESIGN TURNS ON. The gate caches a group's
      // product SET for 60s. A naive set-cache re-breaks the exact bug the
      // old positives-only boolean cache was written to avoid: a Kitabu Yetu
      // group that buys Chama Reminder would have a stale {kitabu_yetu} cached,
      // so the portal it JUST PAID FOR would 402 for up to a minute. "I paid
      // and it's still broken", one product later.
      //
      // Hence: a cached entry may only ever GRANT. Any decision that would DENY
      // re-reads the database. Note there is deliberately no
      // __resetSubscriptionCache() below — resetting it would test nothing.
      const { groupId, officerId } = await createTestGroup('chairperson');

      // Warm the cache with the kitabu_yetu-only set.
      expect((await statusOf.contributions(groupId, officerId)).status).toBe(200);

      await subscribeTestGroup(groupId, 'starter', 'chama_reminder');

      expect((await statusOf.smsUsage(groupId, officerId)).status).toBe(200);
    });
  });
});
