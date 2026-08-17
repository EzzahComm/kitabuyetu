/**
 * Organization subscription plans — real, enforced tiers assigned only by
 * super_admin. See supabase/migrations/20260817000000_152_* and
 * lib/services/organization-plan.service.ts for the full rationale: this is
 * the opposite choice from the group side's currently-decorative
 * PLAN_FEATURES, and there is no self-serve purchase path at all.
 */
import type { TenantContext } from '@/lib/db';
import { assignOrganizationPlan, getOrganizationPlan } from '@/lib/services/organization-plan.service';
import { assignGroupToOrganization } from '@/lib/services/admin-organizations.service';
import { addOrgStaff } from '@/lib/services/organization-members.service';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { organizationService } from '@/lib/services/organization.service';
import { POST as adminPlanPost } from '@/app/api/admin/organizations/[id]/plan/route';
import { createTestOrganization, createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';
import { backofficeHeaders, buildRequest } from './helpers/request';

function ctxFor(userId: string, organizationId: string): TenantContext {
  return { userId, groupId: null, role: 'organization_coordinator', organizationId } as unknown as TenantContext;
}

describe('Organization subscription plans', () => {
  let organizationId: string, coordinatorId: string;

  beforeEach(async () => {
    await resetDatabase();
    ({ organizationId, coordinatorId } = await createTestOrganization());
  });
  afterAll(async () => { await resetDatabase(); });

  describe('assignment', () => {
    it('snapshots the static Growth definition onto the row', async () => {
      const sub = await assignOrganizationPlan(organizationId, 'growth', coordinatorId);
      expect(sub.plan_type).toBe('growth');
      expect(Number(sub.monthly_fee)).toBe(4999);
      expect(sub.max_linked_groups).toBe(15);
      expect(sub.max_staff).toBe(5);
      expect(sub.max_funding_programs).toBe(5);
      expect(Number(sub.sms_allowance_included)).toBe(500);
      expect(sub.white_label_branding).toBe(false);
      expect(sub.advanced_reports).toBe(true);
      expect(sub.support_tier).toBe('priority');
      expect(sub.is_custom).toBe(false);
    });

    it('Premium has unlimited linked groups but a real staff/program cap', async () => {
      const sub = await assignOrganizationPlan(organizationId, 'premium', coordinatorId);
      expect(sub.max_linked_groups).toBeNull();
      expect(sub.max_staff).toBe(15);
      expect(sub.max_funding_programs).toBe(10);
    });

    it('rejects premium_plus with no custom terms — "custom, including pricing" was explicit', async () => {
      await expect(assignOrganizationPlan(organizationId, 'premium_plus', coordinatorId))
        .rejects.toThrow(/monthly fee/i);
    });

    it('premium_plus snapshots exactly the hand-entered terms, defaults white-label true', async () => {
      const sub = await assignOrganizationPlan(organizationId, 'premium_plus', coordinatorId, {
        custom: { monthlyFee: 25000, maxStaff: 3, supportTier: 'priority_plus' },
      });
      expect(Number(sub.monthly_fee)).toBe(25000);
      expect(sub.max_staff).toBe(3);
      expect(sub.max_linked_groups).toBeNull(); // omitted -> unlimited
      expect(sub.white_label_branding).toBe(true);
      expect(sub.is_custom).toBe(true);
    });

    it('a later assignment cancels the prior row rather than mutating it — the snapshot is never retroactively altered', async () => {
      const first = await assignOrganizationPlan(organizationId, 'starter', coordinatorId);
      await assignOrganizationPlan(organizationId, 'growth', coordinatorId);

      const [row] = await rawQuery<{ status: string; monthly_fee: string }>(
        `SELECT status, monthly_fee FROM organization_subscriptions WHERE id = $1`, [first.id],
      );
      expect(row.status).toBe('cancelled');
      expect(Number(row.monthly_fee)).toBe(2999); // untouched — still Starter's fee at the time

      const current = await getOrganizationPlan(organizationId);
      expect(current.subscription?.plan_type).toBe('growth');
    });

    it('writes an audit_logs row with old and new plan values', async () => {
      await assignOrganizationPlan(organizationId, 'starter', coordinatorId);
      await assignOrganizationPlan(organizationId, 'premium', coordinatorId, { notes: 'upgrade' });

      const [audit] = await rawQuery<{ old_values: { plan_type: string }; new_values: { plan_type: string } }>(
        `SELECT old_values, new_values FROM audit_logs
         WHERE action = 'organization.plan_assigned' AND resource_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [organizationId],
      );
      expect(audit.old_values.plan_type).toBe('starter');
      expect(audit.new_values.plan_type).toBe('premium');
    });

    it('grants the bundled SMS allowance immediately as a real credited balance', async () => {
      await assignOrganizationPlan(organizationId, 'growth', coordinatorId); // 500 allowance

      const [account] = await rawQuery<{ sms_credits: string }>(
        `SELECT sms_credits FROM organization_billing_accounts WHERE organization_id = $1`, [organizationId],
      );
      expect(Number(account.sms_credits)).toBe(500);

      const [ledger] = await rawQuery<{ entry_type: string; allowance_amount: string }>(
        `SELECT entry_type, allowance_amount FROM sms_credit_ledger
         WHERE organization_id = $1 AND reference_type = 'plan_allowance'`,
        [organizationId],
      );
      expect(ledger.entry_type).toBe('adjustment');
      expect(Number(ledger.allowance_amount)).toBe(500);
    });

    it('Starter grants no allowance at all (0 included)', async () => {
      await assignOrganizationPlan(organizationId, 'starter', coordinatorId);
      const [account] = await rawQuery<{ sms_credits: string }>(
        `SELECT sms_credits FROM organization_billing_accounts WHERE organization_id = $1`, [organizationId],
      );
      // No row at all is also a valid "never granted anything" outcome.
      expect(Number(account?.sms_credits ?? 0)).toBe(0);
    });
  });

  describe('linked-group cap', () => {
    it('blocks at the cap and allows re-granting an already-active link', async () => {
      await assignOrganizationPlan(organizationId, 'premium_plus', coordinatorId, {
        custom: { monthlyFee: 10000, maxLinkedGroups: 1 },
      });
      const a = await createTestGroup();
      const b = await createTestGroup();

      await assignGroupToOrganization(organizationId, a.groupId, coordinatorId);
      // Re-granting the SAME link must never count as a second slot.
      await expect(assignGroupToOrganization(organizationId, a.groupId, coordinatorId)).resolves.toBeDefined();

      await expect(assignGroupToOrganization(organizationId, b.groupId, coordinatorId))
        .rejects.toThrow(/maximum of 1 linked groups/i);
    });

    it('a null cap (e.g. Premium) never blocks', async () => {
      await assignOrganizationPlan(organizationId, 'premium', coordinatorId); // maxLinkedGroups: null
      const groups = await Promise.all([createTestGroup(), createTestGroup(), createTestGroup()]);
      for (const g of groups) {
        await expect(assignGroupToOrganization(organizationId, g.groupId, coordinatorId)).resolves.toBeDefined();
      }
    });

    it('no plan assigned at all defaults to Starter caps (5), never unlimited', async () => {
      // No assignOrganizationPlan call in this test at all.
      const groups = await Promise.all(Array.from({ length: 5 }, () => createTestGroup()));
      for (const g of groups) {
        await assignGroupToOrganization(organizationId, g.groupId, coordinatorId);
      }
      const sixth = await createTestGroup();
      await expect(assignGroupToOrganization(organizationId, sixth.groupId, coordinatorId))
        .rejects.toThrow(/maximum of 5 linked groups/i);
    });
  });

  describe('staff cap', () => {
    it('blocks adding staff past the cap', async () => {
      await assignOrganizationPlan(organizationId, 'premium_plus', coordinatorId, {
        custom: { monthlyFee: 10000, maxStaff: 1 },
      });
      await addOrgStaff(organizationId, {
        phone: '254700111001', firstName: 'A', lastName: 'One', orgRole: 'staff', invitedBy: coordinatorId,
      });
      await expect(addOrgStaff(organizationId, {
        phone: '254700111002', firstName: 'B', lastName: 'Two', orgRole: 'staff', invitedBy: coordinatorId,
      })).rejects.toThrow(/maximum of 1 staff seats/i);
    });
  });

  describe('funding program cap', () => {
    const grantInput = { name: 'Test Grant', programType: 'grant' as const, budget: 100_000 };

    it('blocks creating an active program past the cap', async () => {
      await assignOrganizationPlan(organizationId, 'premium_plus', coordinatorId, {
        custom: { monthlyFee: 10000, maxFundingPrograms: 1 },
      });
      await organizationFinanceService.createProgram(ctxFor(coordinatorId, organizationId), grantInput);
      await expect(
        organizationFinanceService.createProgram(ctxFor(coordinatorId, organizationId), { ...grantInput, name: 'Second Grant' }),
      ).rejects.toThrow(/maximum of 1 active funding programs/i);
    });
  });

  describe('feature gates', () => {
    it('Starter cannot reach advanced reports; Growth can', async () => {
      await assignOrganizationPlan(organizationId, 'starter', coordinatorId);
      await expect(organizationFinanceService.programBudgetReport(ctxFor(coordinatorId, organizationId)))
        .rejects.toThrow(/Advanced reports.*requires the Growth plan/i);

      await assignOrganizationPlan(organizationId, 'growth', coordinatorId);
      await expect(organizationFinanceService.programBudgetReport(ctxFor(coordinatorId, organizationId)))
        .resolves.toBeDefined();
    });

    it('only Premium+ can set white-label branding — Premium itself cannot', async () => {
      await assignOrganizationPlan(organizationId, 'premium', coordinatorId);
      await expect(
        organizationService.setBranding(ctxFor(coordinatorId, organizationId), { primaryColor: '#123456' }),
      ).rejects.toThrow(/White-label branding.*requires the Premium\+ plan/i);

      await assignOrganizationPlan(organizationId, 'premium_plus', coordinatorId, { custom: { monthlyFee: 30000 } });
      await expect(
        organizationService.setBranding(ctxFor(coordinatorId, organizationId), { primaryColor: '#123456' }),
      ).resolves.toBeDefined();
    });
  });

  describe('route-level authorization', () => {
    it('a support-role caller is denied on the plan-assignment route — assignment is a super_admin action', async () => {
      const res = await adminPlanPost(
        buildRequest(`/api/admin/organizations/${organizationId}/plan`, {
          method: 'POST',
          headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'support' }),
          body: { planType: 'starter' },
        }),
        { params: Promise.resolve({ id: organizationId }) },
      );
      expect(res.status).toBe(403);
    });

    it('super_admin can assign a plan via the route', async () => {
      const res = await adminPlanPost(
        buildRequest(`/api/admin/organizations/${organizationId}/plan`, {
          method: 'POST',
          headers: backofficeHeaders({ userId: coordinatorId, platformRole: 'super_admin' }),
          body: { planType: 'growth' },
        }),
        { params: Promise.resolve({ id: organizationId }) },
      );
      expect(res.status).toBe(200);
    });
  });
});
