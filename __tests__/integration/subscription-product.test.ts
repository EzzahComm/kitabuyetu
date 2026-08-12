/**
 * Multi-product subscriptions (migration 127 — Chama Reminder Phase 2,
 * docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md §5 Decision A),
 * against real Postgres.
 *
 * Until now a group could hold exactly one active subscription. Widening that
 * to one-per-(group, product) is the easy half; the risk is that several
 * existing readers were written against the old invariant and fail SILENTLY
 * rather than loudly once a second row exists — an arbitrary row picked by
 * `SELECT ... INTO`, a cancel that hits every product, an aggregate that emits
 * one list row per product. Each test below pins one of those.
 *
 * Real Postgres specifically: every one of these bugs lives in SQL semantics
 * (partial unique indexes, PL/pgSQL SELECT INTO's silent first-row rule,
 * LATERAL vs join multiplicity) that a mocked database cannot reproduce.
 */
import { billingService } from '@/lib/services/billing.service';
import { listGroups } from '@/lib/services/admin.service';
import { createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import type { TenantContext } from '@/lib/db';

/** Add a second, concurrently-active subscription for the other product. */
async function addChamaReminderSubscription(
  groupId: string,
  opts: { smsRate: number; allowance: number } = { smsRate: 0.80, allowance: 500 },
): Promise<void> {
  await rawQuery(
    `INSERT INTO subscriptions
       (group_id, product, plan_type, status, monthly_fee, sms_rate, sms_allowance_included)
     VALUES ($1, 'chama_reminder', 'growth', 'active', 500, $2, $3)`,
    [groupId, opts.smsRate.toFixed(4), opts.allowance],
  );
}

async function activeSubscriptions(groupId: string) {
  return rawQuery<{ product: string; plan_type: string; status: string }>(
    // product::text, not product: ORDER BY on an enum sorts by DECLARATION
    // order (kitabu_yetu, chama_reminder), which would make these assertions
    // silently depend on how migration 127 happened to list the values.
    `SELECT product, plan_type, status FROM subscriptions
     WHERE group_id = $1 AND status = 'active' ORDER BY product::text`,
    [groupId],
  );
}

function ctxFor(groupId: string, userId: string): TenantContext {
  return { userId, groupId, role: 'chairperson' };
}

describe('multi-product subscriptions (migration 127)', () => {
  it('register_group stamps kitabu_yetu by default, and the named product when asked', async () => {
    await resetDatabase();

    const { groupId } = await createTestGroup('treasurer');
    const [defaulted] = await rawQuery<{ product: string }>(
      `SELECT product FROM subscriptions WHERE group_id = $1`, [groupId],
    );
    expect(defaulted.product).toBe('kitabu_yetu');

    // An explicit product on the payload. Note the chart of accounts is still
    // seeded either way — Decision C's GL-skip is deliberately Phase 4, and
    // this asserts that rather than leaving it ambiguous.
    const [row] = await rawQuery<{ result: { group_id: string } }>(
      `SELECT register_group($1::jsonb) AS result`,
      [JSON.stringify({
        groupName: 'Reminder Only Group', groupType: 'chama',
        firstName: 'Asha', lastName: 'Mwangi', phone: '254798000123',
        passwordHash: 'integration_test_password_hash_placeholder',
        creatorRole: 'treasurer', product: 'chama_reminder',
      })],
    );
    const crGroupId = row.result.group_id;

    const [stamped] = await rawQuery<{ product: string }>(
      `SELECT product FROM subscriptions WHERE group_id = $1`, [crGroupId],
    );
    expect(stamped.product).toBe('chama_reminder');

    const [accounts] = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM accounts WHERE group_id = $1`, [crGroupId],
    );
    expect(Number(accounts.n)).toBe(16);
  });

  it('allows one active subscription per product, and rejects a second for the same product', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');

    await addChamaReminderSubscription(groupId);
    expect(await activeSubscriptions(groupId)).toHaveLength(2);

    // The widened partial unique index still holds WITHIN a product.
    await expect(
      rawQuery(
        `INSERT INTO subscriptions
           (group_id, product, plan_type, status, monthly_fee, sms_rate, sms_allowance_included)
         VALUES ($1, 'kitabu_yetu', 'growth', 'active', 1000, 0.9000, 50)`,
        [groupId],
      ),
    ).rejects.toThrow(/idx_subscriptions_one_active_per_product/);
  });

  it('reserve_sms_credits sums the allowances and charges the best rate across products', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');

    // register_group seeds kitabu_yetu at 0.9000 with a 50-message bundle.
    await addChamaReminderSubscription(groupId, { smsRate: 0.80, allowance: 500 });
    await rawQuery(`UPDATE billing_accounts SET sms_credits = 1000 WHERE group_id = $1`, [groupId]);

    const [{ result }] = await rawQuery<{ result: Record<string, string> }>(
      `SELECT reserve_sms_credits('group', $1, NULL, 600) AS result`, [groupId],
    );

    // MIN(0.90, 0.80) — not whichever row the planner happened to return first,
    // which is what the old SELECT ... INTO over a LEFT JOIN gave.
    expect(Number(result.rate)).toBe(0.80);
    // SUM(50, 500) = 550 free, so 600 messages split 550 allowance / 50 paid.
    expect(Number(result.fromAllowanceCount)).toBe(550);
    expect(Number(result.fromPaidCount)).toBe(50);
    expect(Number(result.fromPaid)).toBeCloseTo(50 * 0.80, 4);
  });

  it('activation cancels only its own product, leaving the other subscription active', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await addChamaReminderSubscription(groupId);

    // Without the product predicate on the cancel UPDATE, this call would
    // cancel BOTH rows and leave the group silently unsubscribed from a
    // product it still pays for. Exercised through the payment-free
    // administrative path (migration 138 moved paid activation behind a
    // confirmed payment); the product-scoping logic is shared by both.
    const upgraded = await billingService.activatePlanWithoutPayment(ctxFor(groupId, officerId), 'growth');
    expect(upgraded.product).toBe('kitabu_yetu');
    expect(upgraded.plan_type).toBe('growth');

    const active = await activeSubscriptions(groupId);
    expect(active).toEqual([
      { product: 'chama_reminder', plan_type: 'growth', status: 'active' },
      { product: 'kitabu_yetu',    plan_type: 'growth', status: 'active' },
    ]);

    // And the Chama Reminder row was never touched — still exactly one
    // cancelled row, the Kitabu Yetu starter this upgrade replaced.
    const cancelled = await rawQuery<{ product: string }>(
      `SELECT product FROM subscriptions WHERE group_id = $1 AND status = 'cancelled'`,
      [groupId],
    );
    expect(cancelled).toEqual([{ product: 'kitabu_yetu' }]);
  });

  it('getSubscription resolves per product rather than picking an arbitrary row', async () => {
    await resetDatabase();
    const { groupId, officerId } = await createTestGroup('chairperson');
    await addChamaReminderSubscription(groupId);
    const ctx = ctxFor(groupId, officerId);

    expect((await billingService.getSubscription(ctx))?.product).toBe('kitabu_yetu');
    expect((await billingService.getSubscription(ctx, 'chama_reminder'))?.plan_type).toBe('growth');
  });

  it('the admin groups list returns one row per group, not one per product', async () => {
    await resetDatabase();
    const { groupId } = await createTestGroup('treasurer');
    await addChamaReminderSubscription(groupId);

    const page = await listGroups({ page: 1, limit: 25 });

    // A plain LEFT JOIN put sub.plan_type in the GROUP BY, so this group would
    // appear twice — while the paired count query's COUNT(DISTINCT g.id) still
    // said 1, desynchronising the pagination.
    const rows = (page.items as { id: string; plan: string }[]).filter((r) => r.id === groupId);
    expect(rows).toHaveLength(1);
    expect(page.total).toBe(page.items.length);

    // Default view is the Kitabu Yetu plan; the filter selects the other.
    expect(rows[0].plan).toBe('starter');
    const crPage = await listGroups({ page: 1, limit: 25, product: 'chama_reminder' });
    const crRows = (crPage.items as { id: string; plan: string }[]).filter((r) => r.id === groupId);
    expect(crRows).toHaveLength(1);
    expect(crRows[0].plan).toBe('growth');
  });
});
