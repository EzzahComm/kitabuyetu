/**
 * Loan funding attribution — capital layer Phase 3 (migration 118). THE KEYSTONE.
 *
 * This is what distinguishes
 *   "the group lent its own savings to a member"
 * from
 *   "the group on-lent an organization's capital to a member"
 * which are otherwise the same row in `loans`.
 *
 * Modelled on the real EZZAHCOMM → THE FIONA'S operation: capital arrives as a
 * mobile-money funding allocation, and the group on-lends it to individual members.
 */
import type { TenantContext } from '@/lib/db';
import { loansService } from '@/lib/services/loans.service';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { listForGroup, getLoanFundingSplits } from '@/lib/services/funding-sources.service';
import { createTestOrganization, createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

describe('loan funding attribution', () => {
  let orgId: string, coordId: string, approverId: string;
  let groupId: string, officerId: string;
  let internalSourceId: string, allocationSourceId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId: orgId, coordinatorId: coordId } = await createTestOrganization());
    ({ groupId, officerId } = await createTestGroup('chairperson'));
    ({ coordinatorId: approverId } = await createTestOrganization());

    await rawQuery(
      `INSERT INTO organization_members (organization_id, member_id, org_role, status)
       VALUES ($1,$2,'lead','active') ON CONFLICT DO NOTHING`,
      [orgId, approverId],
    );
    await rawQuery(
      `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
       VALUES ($1,$2,'read',$3,true) ON CONFLICT DO NOTHING`,
      [orgId, groupId, coordId],
    );

    // The real shape: a 1.5M fund, 1M allocated in cash for on-lending.
    const orgCtx = {
      userId: coordId,
      groupId: null,
      role: 'organization_coordinator',
      organizationId: orgId,
    } as unknown as TenantContext;
    const approverCtx = { ...orgCtx, userId: approverId } as TenantContext;

    const fund = await organizationFinanceService.createProgram(orgCtx, {
      name: 'Seed Capital',
      programType: 'seed_capital',
      budget: 1_500_000,
    });
    await organizationFinanceService.deposit(orgCtx, { amount: 1_500_000, source: 'Cash' });
    const disb = await organizationFinanceService.disburse(orgCtx, {
      groupId,
      amount: 1_000_000,
      disbursementType: 'seed_capital',
      fundingProgramId: fund.id,
      purpose: 'On-lending to members',
    });
    if (disb.status === 'pending_approval') {
      await organizationFinanceService.approveDisbursement(approverCtx, disb.id);
    }

    const sources = await listForGroup(groupCtx());
    internalSourceId = sources.find((s) => s.sourceType === 'internal_savings')!.id;
    allocationSourceId = sources.find((s) => s.sourceType === 'organization_allocation')!.id;
  });

  afterAll(async () => {
    await resetDatabase();
  });

  function groupCtx(): TenantContext {
    return { userId: officerId, groupId, role: 'chairperson' } as unknown as TenantContext;
  }

  /**
   * Applies + approves a loan for a fresh member, returning its id.
   *
   * Creates the member through the real membersService (via addGroupOfficer)
   * rather than hand-inserting into group_members — that table has grown across
   * ~118 migrations and now requires person_id, which a hand-rolled INSERT
   * silently misses. fixtures.ts makes exactly this point; a first draft here
   * ignored it and every test in this file failed on the NOT NULL.
   */
  async function approvedLoan(principal: number): Promise<string> {
    const borrowerId = await addGroupOfficer(groupId, officerId, 'member');

    const loan = await loansService.apply(groupCtx(), {
      memberId: borrowerId,
      principalAmount: principal,
      interestRate: 10,
      loanTermMonths: 6,
    } as never);
    await loansService.approve(groupCtx(), loan.id, {} as never);
    return loan.id;
  }

  it('does not post loan funding attribution from a manual disbursement or typed receipt', async () => {
    const loanId = await approvedLoan(50_000);
    await expect(
      loansService.disburse(groupCtx(), loanId, {
        disbursementDate: new Date().toISOString().slice(0, 10),
        paymentMethod: 'mpesa',
        mpesaReceiptNumber: 'FAKE-MANUAL-RECEIPT',
      } as never),
    ).rejects.toThrow(/Manual loan disbursement is disabled/i);

    const splits = await getLoanFundingSplits(groupCtx(), loanId);
    expect(splits).toHaveLength(0);
  });

});
