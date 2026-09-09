/**
 * Platform-wide paid-subscription lock (migration 139) against real Postgres.
 *
 * Every plan is paid, so a group with no active subscription is locked out of
 * the product. Before this the only enforcement anywhere was
 * assertFeatureAccess on the two import routes plus reserve_sms_credits' own
 * check, so an unpaid group kept full access to contributions, loans and
 * accounting — "no free plan" meant nothing in practice.
 *
 * THE CARVE-OUTS ARE THE POINT. A lock that also blocks paying is an outage,
 * not a business model: a locked group must still reach sign-in, the plan
 * list, and the M-Pesa endpoints, then be unlocked by its own payment. The
 * tests below walk that whole loop, because every individual piece can look
 * correct while the loop stays closed.
 */
import { GET as billingPlansGet } from '@/app/api/v1/billing/plans/route';
import { GET as contributionsGet } from '@/app/api/v1/contributions/route';
import { GET as smsUsageGet } from '@/app/api/v1/sms/usage/route';
import { buildRequest, authHeaders } from './helpers/request';
import { createTestGroup, subscribeTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

import { __resetSubscriptionCache } from '@/lib/auth/subscription-gate';

function headersFor(groupId: string, officerId: string, role = 'chairperson') {
  return authHeaders({
    userId: officerId, groupId, role,
    permissions: ['billing.manage', 'contributions.view', 'contributions.record'],
  });
}

describe('paid-subscription lock', () => {
  let groupId: string;
  let officerId: string;

  beforeEach(async () => {
    await resetDatabase();
    // The gate caches positive results for 60s in-process, which outlives a
    // test. Clearing keeps each case reading live subscription state rather
    // than an entitlement an earlier test warmed.
    __resetSubscriptionCache();
    // Genuinely unpaid, exactly as register_group now leaves a new group.
    ({ groupId, officerId } = await createTestGroup('chairperson', { subscribed: false }));
  });

  it('locks a feature route for a group that has never paid', async () => {
    const res = await contributionsGet(
      buildRequest('/api/v1/contributions', { headers: headersFor(groupId, officerId) }),
    );
    expect(res.status).toBe(402);

    const body = await res.json() as { code: string };
    expect(body.code).toBe('PAYMENT_REQUIRED');
  });

  it('still lets a locked group reach billing, so it can see what it owes and pay', async () => {
    // If this ever 402s the product is unrecoverable: the only route that can
    // end the lock would itself be behind the lock.
    const res = await billingPlansGet(
      buildRequest('/api/v1/billing/plans', { headers: headersFor(groupId, officerId) }),
    );
    expect(res.status).toBe(200);

    const body = await res.json() as { data: { plans: { plan: string; monthlyFee: number }[] } };
    expect(body.data.plans.map((p) => p.plan)).toEqual(
      expect.arrayContaining(['starter', 'growth', 'premium', 'enterprise']),
    );
    // And it must quote real prices, or there is nothing actionable to pay.
    expect(body.data.plans.find((p) => p.plan === 'starter')?.monthlyFee).toBe(150);
  });

  it('unlocks the moment a subscription becomes active', async () => {
    const locked = await contributionsGet(
      buildRequest('/api/v1/contributions', { headers: headersFor(groupId, officerId) }),
    );
    expect(locked.status).toBe(402);

    await subscribeTestGroup(groupId);

    // No cache invalidation step: only positive results are cached, so paying
    // takes effect immediately rather than after a TTL. A group that pays and
    // stays locked reads as "I paid and it's still broken".
    const unlocked = await contributionsGet(
      buildRequest('/api/v1/contributions', { headers: headersFor(groupId, officerId) }),
    );
    expect(unlocked.status).toBe(200);
  });

  it('re-locks when the only subscription is expired', async () => {
    await subscribeTestGroup(groupId);
    expect((await contributionsGet(
      buildRequest('/api/v1/contributions', { headers: headersFor(groupId, officerId) }),
    )).status).toBe(200);

    // Exactly what migration 139 does to the legacy free plans.
    await rawQuery(
      `UPDATE subscriptions SET status = 'expired' WHERE group_id = $1`, [groupId],
    );

    // Losing entitlement is NOT instant, by design: a positive is cached for
    // up to 60s, so the group keeps working until it lapses. That tradeoff is
    // deliberate — staleness costs at most a minute of access for a group that
    // just stopped paying, whereas caching negatives would leave a group that
    // just PAID locked out. Clearing here asserts the post-expiry behaviour
    // rather than waiting out the TTL.
    __resetSubscriptionCache();

    expect((await contributionsGet(
      buildRequest('/api/v1/contributions', { headers: headersFor(groupId, officerId) }),
    )).status).toBe(402);
  });

  it('does not lock support staff out of an unpaid group', async () => {
    // Support has to be able to look at a group precisely when it is unpaid.
    const res = await contributionsGet(
      buildRequest('/api/v1/contributions', {
        headers: authHeaders({
          userId: officerId, groupId, role: 'super_admin',
          permissions: ['contributions.view'],
        }),
      }),
    );
    expect(res.status).toBe(200);
  });

  it('a subscription for a DIFFERENT product does NOT unlock this one', async () => {
    // DELIBERATE REVERSAL (migration 140). This case used to assert 200: the
    // gate asked "is this group paying for anything", not "is it paying for
    // kitabu_yetu". That was right while Chama Reminder was only ever an add-on
    // to a real Kitabu Yetu group, and became wrong the moment a group could
    // register for Chama Reminder alone — register_group gives such a group no
    // chart of accounts, so letting it in here does not grant it a working
    // contributions page, it just moves the failure somewhere deeper and more
    // confusing (a posting template complaining about missing account codes).
    //
    // The distinct code is what the client uses to send this group to its own
    // subscribe page instead of Kitabu Yetu's billing page.
    await subscribeTestGroup(groupId, 'growth', 'chama_reminder');

    const res = await contributionsGet(
      buildRequest('/api/v1/contributions', { headers: headersFor(groupId, officerId) }),
    );
    expect(res.status).toBe(402);

    const body = await res.json() as { code: string };
    expect(body.code).toBe('PRODUCT_NOT_ENTITLED');
  });

  it('but that subscription DOES unlock the surface it actually bought', async () => {
    // The other half of the reversal above, and the reason it is safe: a Chama
    // Reminder subscriber is a paying customer and must reach the product it
    // paid for. If this ever fails, the previous test has stopped being a
    // product boundary and started being an outage.
    await subscribeTestGroup(groupId, 'growth', 'chama_reminder');

    const res = await smsUsageGet(
      buildRequest('/api/v1/sms/usage', {
        headers: authHeaders({
          userId: officerId, groupId, role: 'chairperson',
          permissions: ['messaging.view', 'messaging.send'],
        }),
      }),
    );
    expect(res.status).toBe(200);
  });
});
