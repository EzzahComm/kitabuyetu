/**
 * RBAC permission activation, Batch 9 — the final batch
 * (SIMPLIFICATION_AND_RBAC_AUDIT.md Workstream 4). Loans/Credit-scores/
 * Accounting/M-Pesa/Payment-requests map mostly onto strings already seeded
 * in 077/079 (loans.approve, mpesa.view, payments.request, payments.disburse,
 * accounting.manage, reports.view, admin.recompute, treasury.manage,
 * payouts.manage); four routes needed new strings added in migration 113
 * (loans.policy.manage, credit_scores.policy.manage, credit_scores.recompute,
 * mpesa.bill_manager.manage). This also proves the assertAuthFresh
 * tightening: the 8 sensitive routes now re-verify the required permission
 * against LIVE roles.permissions after the epoch check, not just the JWT's
 * bounded-stale claim.
 */
import { GET as accountsGet, POST as accountsPost } from '@/app/api/v1/accounting/accounts/route';
import { GET as reportsGet } from '@/app/api/v1/accounting/reports/route';
import { PUT as loansPolicyPut } from '@/app/api/v1/loans/policy/route';
import { PUT as creditPolicyPut } from '@/app/api/v1/credit-scores/policy/route';
import { POST as creditRecomputeAllPost } from '@/app/api/v1/credit-scores/recompute/route';
import { GET as mpesaTxGet } from '@/app/api/v1/mpesa/transactions/route';
import { GET as billManagerGet } from '@/app/api/v1/mpesa/bill-manager/route';
import { POST as paymentRequestsPost } from '@/app/api/v1/payment-requests/route';
import { POST as memberStatusPost } from '@/app/api/v1/members/[id]/status/route';
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

describe('Loans/Treasury/M-Pesa/Accounting permission gates (final batch)', () => {
  let groupId: string, memberId: string, plainMemberId: string;
  let memberPerms: string[], treasurerPerms: string[], chairpersonPerms: string[];

  beforeAll(async () => {
    await resetDatabase();
    const { groupId: gId, officerId: founderId } = await createTestGroup('chairperson');
    groupId       = gId;
    memberId      = founderId;
    plainMemberId = await addGroupOfficer(gId, founderId, 'member');
    memberPerms      = await permissionsFor('member');
    treasurerPerms   = await permissionsFor('treasurer');
    chairpersonPerms = await permissionsFor('chairperson');
  });

  afterAll(async () => {
    await resetDatabase();
  });

  it('accounting.manage: member denied POST /accounting/accounts, treasurer allowed; GET is unguarded (withAuth)', async () => {
    const denied = await accountsPost(buildRequest('/api/v1/accounting/accounts', {
      method: 'POST', body: { code: '9999', name: 'Test Account', accountType: 'asset' },
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const readAllowed = await accountsGet(buildRequest('/api/v1/accounting/accounts', {
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(readAllowed.status).toBe(200);
  });

  it('reports.view: member is denied, treasurer is allowed', async () => {
    const denied = await reportsGet(buildRequest('/api/v1/accounting/reports', {
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await reportsGet(buildRequest('/api/v1/accounting/reports', {
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('loans.policy.manage (new, migration 113): treasurer is denied, chairperson is allowed', async () => {
    const denied = await loansPolicyPut(buildRequest('/api/v1/loans/policy', {
      method: 'PUT', body: { interestRate: 12, interestMethod: 'flat', maxTermMonths: 12, loanMultiplier: 3 },
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await loansPolicyPut(buildRequest('/api/v1/loans/policy', {
      method: 'PUT', body: { interestRate: 12, interestMethod: 'flat', maxTermMonths: 12, loanMultiplier: 3 },
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('credit_scores.policy.manage (new) and admin.recompute (existing, reused for bulk recompute): both chairperson-only', async () => {
    const deniedPolicy = await creditPolicyPut(buildRequest('/api/v1/credit-scores/policy', {
      method: 'PUT', body: { thresholds: [{ tier: 'gold', minScore: 80, loanMultiplier: 4 }] },
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(deniedPolicy.status).toBe(403);

    const deniedRecompute = await creditRecomputeAllPost(buildRequest('/api/v1/credit-scores/recompute', {
      method: 'POST',
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(deniedRecompute.status).toBe(403);

    const allowedRecompute = await creditRecomputeAllPost(buildRequest('/api/v1/credit-scores/recompute', {
      method: 'POST',
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowedRecompute.status).toBe(200);
  });

  it('mpesa.view: member denied listing transactions, treasurer allowed', async () => {
    const denied = await mpesaTxGet(buildRequest('/api/v1/mpesa/transactions', {
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await mpesaTxGet(buildRequest('/api/v1/mpesa/transactions', {
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('mpesa.bill_manager.manage (new): treasurer denied, chairperson allowed', async () => {
    const denied = await billManagerGet(buildRequest('/api/v1/mpesa/bill-manager', {
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await billManagerGet(buildRequest('/api/v1/mpesa/bill-manager', {
      headers: authHeaders({ userId: memberId, groupId, role: 'chairperson', permissions: chairpersonPerms }),
    }));
    expect(allowed.status).toBe(200);
  });

  it('payments.request: member is denied, treasurer is allowed', async () => {
    const denied = await paymentRequestsPost(buildRequest('/api/v1/payment-requests', {
      method: 'POST', body: { memberId: plainMemberId, product: 'savings', amount: 1000 },
      headers: authHeaders({ userId: memberId, groupId, role: 'member', permissions: memberPerms }),
    }));
    expect(denied.status).toBe(403);

    const allowed = await paymentRequestsPost(buildRequest('/api/v1/payment-requests', {
      method: 'POST', body: { memberId: plainMemberId, product: 'savings', amount: 1000 },
      headers: authHeaders({ userId: memberId, groupId, role: 'treasurer', permissions: treasurerPerms }),
    }));
    expect(allowed.status).toBe(201);
  });

  it('assertAuthFresh tightening: a forged treasurer/members.manage claim that matches the epoch but NOT the live DB role is still denied', async () => {
    // plainMemberId really is a 'member' in the DB (auth_version defaults to
    // 1, matching the forged authVersion below) — so the epoch check inside
    // assertAuthFresh passes silently, but the live roles.permissions lookup
    // it now also returns has none of the elevated permissions this forged
    // claim asserts. Without the Batch 9 tightening, the route's FIRST gate
    // (checking the forged x-permissions header) would have let this through.
    const res = await memberStatusPost(
      buildRequest(`/api/v1/members/${plainMemberId}/status`, {
        method: 'POST',
        body: { status: 'suspended', reason: 'testing stale-claim rejection' },
        headers: authHeaders({
          userId: plainMemberId, groupId, role: 'treasurer',
          permissions: ['members.manage'], authVersion: 1, sessionVersion: 1,
        }),
      }),
      { params: Promise.resolve({ id: plainMemberId }) },
    );
    expect(res.status).toBe(403);
  });
});
