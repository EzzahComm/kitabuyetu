import crypto from 'crypto';
import type { TenantContext } from '@/lib/db';
import { PLAN_MONTHLY_FEES, type PlanType, type SubscriptionProduct } from '@/types/enums';
import { membersService } from '@/lib/services/members.service';
import { disbursementsService } from '@/lib/services/disbursements.service';
import { paymentRequestsService } from '@/lib/services/payment-requests.service';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { updatePlatformUserRole } from '@/lib/services/admin.service';
import { createOrganization, assignGroupToOrganization } from '@/lib/services/admin-organizations.service';
import { rawQuery } from './db';

// register_group() requires E.164 Kenyan format (2547######## / 2541########)
// and phone is UNIQUE across the whole `members` table. Each test file is a
// separate Jest module instance, so a simple in-process counter would repeat
// across files — use a random 8-digit block instead.
function uniquePhone(): string {
  return `2547${crypto.randomInt(10_000_000, 100_000_000)}`;
}

const DUMMY_PASSWORD_HASH = 'integration_test_password_hash_placeholder';

export interface TestGroup {
  groupId: string;
  officerId: string;
}

/**
 * Creates a fully valid group + founding officer via the app's own
 * register_group() RPC — reuses real validated logic instead of hand-rolling
 * INSERTs against a schema that's evolved across ~95 migrations since it was
 * first defined.
 *
 * Since migration 139 register_group creates NO subscription (there is no free
 * plan), and assertSubscriptionActive locks a group with none out of every
 * route except sign-in and billing. A test group that can actually exercise
 * the product is therefore a group that has PAID, so one is provisioned here
 * by default — otherwise every route-level test would assert against a 402
 * rather than the behaviour it is trying to cover.
 *
 * Pass `{ subscribed: false }` to get a genuinely unpaid group, which is what
 * the lock's own tests need.
 */
export async function createTestGroup(
  creatorRole: 'chairperson' | 'secretary' | 'treasurer' = 'treasurer',
  opts: { subscribed?: boolean } = {},
): Promise<TestGroup> {
  const phone = uniquePhone();
  const [row] = await rawQuery<{ result: { group_id: string; member_id: string } }>(
    `SELECT register_group($1::jsonb) AS result`,
    [JSON.stringify({
      groupName: `Integration Test Group ${phone}`,
      groupType: 'chama',
      firstName: 'Test',
      lastName: 'Officer',
      phone,
      passwordHash: DUMMY_PASSWORD_HASH,
      creatorRole,
    })],
  );
  const groupId = row.result.group_id;

  if (opts.subscribed !== false) await subscribeTestGroup(groupId);

  return { groupId, officerId: row.result.member_id };
}

/**
 * Gives a group a paid active subscription, standing in for an M-Pesa purchase.
 * Deliberately a plain INSERT rather than activateSubscriptionForPayment():
 * fixtures should not depend on the very code path under test, and most suites
 * want a subscribed group without caring how it was bought.
 */
export async function subscribeTestGroup(
  groupId: string,
  planType: PlanType = 'starter',
  product: SubscriptionProduct = 'kitabu_yetu',
): Promise<void> {
  await rawQuery(
    `INSERT INTO subscriptions
       (group_id, product, plan_type, status, started_at, monthly_fee, sms_rate,
        sms_allowance_included, max_members)
     VALUES ($1,$2,$3,'active',NOW(),$4,0.9000,50,NULL)
     ON CONFLICT DO NOTHING`,
    [groupId, product, planType, PLAN_MONTHLY_FEES[product][planType].toFixed(2)],
  );
}

/** Adds a second officer to an existing group via the real membersService (handles person_id/member_code correctly) — needed for maker-checker tests where approver must differ from initiator. */
export async function addGroupOfficer(
  groupId: string,
  actorMemberId: string,
  role: 'chairperson' | 'secretary' | 'treasurer' | 'member',
): Promise<string> {
  const ctx: TenantContext = { userId: actorMemberId, groupId, role: 'chairperson' };
  const member = await membersService.create(ctx, {
    phone: uniquePhone(),
    firstName: 'Second',
    lastName: 'Officer',
    role,
  } as Parameters<typeof membersService.create>[1]);
  return member.id;
}

/** Tops up the group's seeded 1001 Cash and M-Pesa account so disbursement/payment fixtures pass the balance check. Direct UPDATE is safe here: `accounts.balance` is a stable column unchanged since its original migration. */
export async function fundGroupCashAccount(groupId: string, amount: number): Promise<void> {
  await rawQuery(
    `UPDATE accounts SET balance = $1 WHERE group_id = $2 AND account_code = '1001'`,
    [amount.toFixed(2), groupId],
  );
}

export interface TestPaymentRequest {
  id: string;
}

/** Opens a real payment_requests row via paymentRequestsService.create (status='open'). */
export async function createTestPaymentRequest(
  groupId: string, officerId: string, memberId: string, amount = 1000,
): Promise<TestPaymentRequest> {
  const ctx: TenantContext = { userId: officerId, groupId, role: 'treasurer' };
  const row = await paymentRequestsService.create(ctx, {
    memberId, product: 'savings', amount,
  });
  return { id: (row as { id: string }).id };
}

export interface TestDisbursement {
  id: string;
}

/**
 * Initiates a real disbursement_requests row via disbursementsService
 * (requires_approval = true — amount set above the group's default 20,000
 * maker-checker threshold, lib/services/approval-policy.service.ts's
 * FALLBACKS.group_disbursement_threshold), so it lands in pending_approval
 * for the approve/reject tests.
 */
export async function createTestDisbursement(
  groupId: string, initiatorId: string, amount = 50_000,
): Promise<TestDisbursement> {
  await fundGroupCashAccount(groupId, amount * 10);
  const ctx: TenantContext = { userId: initiatorId, groupId, role: 'treasurer' };
  const result = await disbursementsService.initiateDisbursement(ctx, {
    phone: uniquePhone(),
    amount,
    occasion: 'Integration test disbursement',
    idempotencyKey: crypto.randomUUID(),
  });
  return { id: result.id };
}

export interface TestOrganization {
  organizationId: string;
  coordinatorId: string;
}

/**
 * Creates a member with platform_role='organization_coordinator'. Note:
 * `assertOrganizationCoordinator` (organization.service.ts) checks only
 * `ctx.role === 'organization_coordinator' && ctx.organizationId` — there is
 * no DB-level link tying a specific coordinator member to a specific
 * organization, so any coordinator member works for any organizationId in
 * this fixture; a fresh member per call is enough to get a distinct actor
 * for maker-checker tests.
 */
export async function createOrgCoordinator(): Promise<string> {
  const [{ id }] = await rawQuery<{ id: string }>(
    `INSERT INTO members (phone, password_hash, first_name, last_name)
     VALUES ($1, $2, 'Test', 'Coordinator') RETURNING id`,
    [uniquePhone(), DUMMY_PASSWORD_HASH],
  );
  await updatePlatformUserRole(id, 'organization_coordinator');
  return id;
}

/** Creates an organization + its first coordinator, reusing the real admin services (createOrganization, updatePlatformUserRole) rather than hand-inserting into a table whose columns have grown across several migrations. */
export async function createTestOrganization(): Promise<TestOrganization> {
  const org = await createOrganization({
    name: `Integration Test Org ${crypto.randomUUID().slice(0, 8)}`,
    type: 'ngo',
  });
  const coordinatorId = await createOrgCoordinator();
  return { organizationId: (org as { id: string }).id, coordinatorId };
}

export interface TestOrgDisbursement {
  id: string;
}

/**
 * Links the org to a group, funds the wallet, and creates a real
 * organization_disbursements row via organizationFinanceService (amount set
 * above the 50,000 default org_disbursement_threshold fallback), landing in
 * pending_approval for the approve/reject tests.
 */
export async function createTestOrgDisbursement(
  organizationId: string, coordinatorId: string, groupId: string, amount = 100_000,
): Promise<TestOrgDisbursement> {
  await assignGroupToOrganization(organizationId, groupId, coordinatorId, 'read');

  const ctx: TenantContext = {
    userId: coordinatorId, groupId, role: 'organization_coordinator', organizationId,
  };
  // getWallet() lazily bootstraps the organization_wallets row (createOrganization
  // itself doesn't); deposit()'s own getWalletForUpdate() has no such fallback and
  // throws NotFoundError against a brand-new org.
  await organizationFinanceService.getWallet(ctx);
  await organizationFinanceService.deposit(ctx, { amount: amount * 10, source: 'Integration test funding' });
  const disb = await organizationFinanceService.disburse(ctx, {
    groupId, amount, disbursementType: 'grant',
  });
  return { id: disb.id };
}
