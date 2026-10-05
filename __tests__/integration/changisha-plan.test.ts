/**
 * The Changi$ha plan (migration 213), against real Postgres: a group can create
 * and launch campaigns only while it holds an active 'changisha' subscription,
 * bought through the shared plan checkout at the Kumbusha price points.
 */
import { withAdminDb } from '@/lib/db';
import { billingService } from '@/lib/services/billing.service';
import { campaignsService } from '@/lib/services/campaigns.service';
import { ChangishaPlanRequiredError } from '@/lib/services/campaign-plan.service';
import { GET as eligibilityGet } from '@/app/api/v1/campaigns/eligibility/route';
import { GET as membersGet } from '@/app/api/v1/members/route';
import { __resetSubscriptionCache } from '@/lib/auth/subscription-gate';
import { PLAN_MONTHLY_FEES, PLAN_SMS_ALLOWANCE } from '@/types/enums';
import { addGroupOfficer, createTestGroup } from './helpers/fixtures';
import { authHeaders, buildRequest } from './helpers/request';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

async function payFor(groupId: string, planType: 'starter' | 'growth' | 'premium', amount: number): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 14);
  const checkoutId = `ws_CO_${suffix}`;
  await rawQuery(
    `INSERT INTO mpesa_stk_requests
       (group_id, checkout_request_id, merchant_request_id, phone, amount,
        account_reference, description, purpose, status, plan_type, product)
     VALUES ($1,$2,$3,'254700000000',$4,'CHANGISHA','plan','subscription','completed',$5,'changisha')`,
    [groupId, checkoutId, `mr_${suffix}`, amount.toFixed(2), planType],
  );
  const [row] = await rawQuery<{ id: string }>(
    `INSERT INTO payments (group_id, amount, payment_method, status, mpesa_checkout_request_id, payment_date)
     VALUES ($1,$2,'mpesa','completed',$3,NOW()) RETURNING id`,
    [groupId, amount.toFixed(2), checkoutId],
  );
  return row.id;
}

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

describe('Changi$ha plan', () => {
  let groupId: string, treasurerId: string;
  const ctx = () => ({ userId: treasurerId, groupId, role: 'treasurer' });
  const input = { title: 'Water for Kianjege', story: 'A borehole for the village.', targetAmount: 50000 };

  beforeAll(async () => {
    await resetDatabase();
    const g = await createTestGroup('treasurer'); // subscribed to Kitabu Yetu by the fixture
    groupId = g.groupId;
    treasurerId = g.officerId;
    await addGroupOfficer(groupId, treasurerId, 'chairperson');
    await addGroupOfficer(groupId, treasurerId, 'secretary');
  });

  beforeEach(() => __resetSubscriptionCache());
  afterAll(async () => {
    await resetDatabase();
  });

  it('prices plans from KES 100, matching Kumbusha', () => {
    expect(PLAN_MONTHLY_FEES.changisha).toEqual({ starter: 100, growth: 250, premium: 400, enterprise: 0 });
  });

  it('refuses to create a campaign without a plan, even with all three offices filled', async () => {
    await expect(campaignsService.createCampaign(ctx(), input)).rejects.toBeInstanceOf(ChangishaPlanRequiredError);
  });

  it('reports eligibility: offices complete, plan missing', async () => {
    const res = await eligibilityGet(
      buildRequest('/api/v1/campaigns/eligibility', {
        headers: authHeaders({
          userId: treasurerId,
          groupId,
          role: 'treasurer',
          permissions: await permissionsFor('treasurer'),
        }),
      }),
    );
    const body = await res.json();
    expect(body.data ?? body).toMatchObject({ complete: true, planActive: false, eligible: false });
  });

  it('rejects a payment below the plan price', async () => {
    const paymentId = await payFor(groupId, 'starter', 99);
    await expect(
      withAdminDb((db) =>
        billingService.activateSubscriptionForPayment(db, {
          groupId,
          planType: 'starter',
          product: 'changisha',
          paymentId,
          amountPaid: 99,
        }),
      ),
    ).rejects.toThrow(/does not cover/i);
  });

  it('activates on a KES 100 payment, bundles the SMS allowance, and unlocks campaigns', async () => {
    const paymentId = await payFor(groupId, 'starter', 100);
    const sub = await withAdminDb((db) =>
      billingService.activateSubscriptionForPayment(db, {
        groupId,
        planType: 'starter',
        product: 'changisha',
        paymentId,
        amountPaid: 100,
      }),
    );
    expect(sub?.status).toBe('active');
    expect(Number(sub?.monthly_fee)).toBe(100);
    expect(Number(sub?.sms_allowance_included)).toBe(PLAN_SMS_ALLOWANCE.changisha.starter);

    const campaign = await campaignsService.createCampaign(ctx(), input);
    expect(campaign.status).toBe('draft');
  });

  it('does not touch the Kitabu Yetu subscription', async () => {
    const rows = await rawQuery<{ product: string }>(
      `SELECT product::text AS product FROM subscriptions WHERE group_id = $1 AND status = 'active' ORDER BY 1`,
      [groupId],
    );
    expect(rows.map((r) => r.product)).toEqual(['changisha', 'kitabu_yetu']);
  });

  it('stops creating and launching campaigns again once the plan lapses', async () => {
    const [draft] = await rawQuery<{ id: string }>(`SELECT id FROM campaigns WHERE group_id = $1`, [groupId]);
    await rawQuery(`UPDATE campaigns SET payout_phone = '254712345678' WHERE id = $1`, [draft.id]); // so only the plan blocks it
    await rawQuery(`UPDATE subscriptions SET status = 'expired' WHERE group_id = $1 AND product = 'changisha'`, [
      groupId,
    ]);
    await expect(campaignsService.createCampaign(ctx(), input)).rejects.toBeInstanceOf(ChangishaPlanRequiredError);
    await expect(campaignsService.submitForReview(ctx(), draft.id)).rejects.toBeInstanceOf(ChangishaPlanRequiredError);
  });

  it('a Changi$ha plan alone does not open the Kitabu Yetu surface', async () => {
    const solo = await createTestGroup('treasurer', { subscribed: false });
    await rawQuery(
      `INSERT INTO subscriptions (group_id, product, plan_type, status, monthly_fee, sms_rate, sms_allowance_included)
       VALUES ($1, 'changisha', 'starter', 'active', 100, 0.9, 100)`,
      [solo.groupId],
    );
    const res = await membersGet(
      buildRequest('/api/v1/members', {
        headers: authHeaders({
          userId: solo.officerId,
          groupId: solo.groupId,
          role: 'treasurer',
          permissions: await permissionsFor('treasurer'),
        }),
      }),
    );
    expect(res.status).toBe(402);
  });
});
