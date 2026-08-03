/**
 * RBAC permission activation, Batch 6 (SIMPLIFICATION_AND_RBAC_AUDIT.md
 * Workstream 4). Billing's 3 chairperson-tier routes map onto the existing
 * `billing.manage` string; fines/policy PUT needed a new dedicated
 * `fines.manage` string (migration 112) rather than reusing billing.manage
 * for an unrelated concern. Proves both against real Postgres.
 */
import { GET as invoicesGet } from '@/app/api/v1/billing/invoices/route';
import { POST as paymentsPost } from '@/app/api/v1/billing/payments/route';
import { POST as plansPost } from '@/app/api/v1/billing/plans/route';
import { PUT as finesPolicyPut } from '@/app/api/v1/fines/policy/route';
import { authHeaders, buildRequest } from '../helpers/request';
import { createTestGroup, addGroupOfficer } from '../helpers/fixtures';
import { resetDatabase } from '../helpers/cleanup';
import { rawQuery } from '../helpers/db';

async function permissionsFor(role: string): Promise<string[]> {
  const [row] = await rawQuery<{ permissions: string[] }>(
    `SELECT permissions FROM public.roles WHERE group_id IS NULL AND code = $1`,
    [role],
  );
  return row.permissions;
}

describe('Billing/Fines permission gates', () => {
  let groupId: string, memberId: string;
  let treasurerPerms: string[], chairpersonPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    const { groupId: gId, officerId: founderId } = await createTestGroup('chairperson');
    groupId  = gId;
    memberId = await addGroupOfficer(gId, founderId, 'treasurer');
    treasurerPerms   = await permissionsFor('treasurer');
    chairpersonPerms = await permissionsFor('chairperson');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('billing.manage: treasurer is denied on all 3 billing routes, chairperson is allowed', async () => {
    const deniedInvoices = await invoicesGet(buildRequest('/api/v1/billing/invoices', {
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(deniedInvoices.status).toBe(403);

    const allowedInvoices = await invoicesGet(buildRequest('/api/v1/billing/invoices', {
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowedInvoices.status).toBe(200);

    const deniedTopup = await paymentsPost(buildRequest('/api/v1/billing/payments', {
      method: 'POST', body: { type: 'sms_topup', amount: 500 },
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(deniedTopup.status).toBe(403);

    const allowedTopup = await paymentsPost(buildRequest('/api/v1/billing/payments', {
      method: 'POST', body: { type: 'sms_topup', amount: 500 },
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowedTopup.status).toBe(200);

    const deniedPlan = await plansPost(buildRequest('/api/v1/billing/plans', {
      method: 'POST', body: { planType: 'growth' },
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(deniedPlan.status).toBe(403);
  });

  it('fines.manage: treasurer is denied setting the fine schedule, chairperson is allowed', async () => {
    const denied = await finesPolicyPut(buildRequest('/api/v1/fines/policy', {
      method: 'PUT', body: { schedule: { late_contribution: 100 } },
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await finesPolicyPut(buildRequest('/api/v1/fines/policy', {
      method: 'PUT', body: { schedule: { late_contribution: 100 } },
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowed.status).toBe(200);
  });
});
