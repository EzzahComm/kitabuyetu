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
 * cash allocation, and the group on-lends it to individual members.
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
       VALUES ($1,$2,'lead','active') ON CONFLICT DO NOTHING`, [orgId, approverId],
    );
    await rawQuery(
      `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
       VALUES ($1,$2,'read',$3,true) ON CONFLICT DO NOTHING`, [orgId, groupId, coordId],
    );

    // The real shape: a 1.5M fund, 1M allocated in cash for on-lending.
    const orgCtx = {
      userId: coordId, groupId: null, role: 'organization_coordinator', organizationId: orgId,
    } as unknown as TenantContext;
    const approverCtx = { ...orgCtx, userId: approverId } as TenantContext;

    const fund = await organizationFinanceService.createProgram(orgCtx, {
      name: 'Seed Capital', programType: 'seed_capital', budget: 1_500_000,
    });
    await organizationFinanceService.deposit(orgCtx, { amount: 1_500_000, source: 'Cash' });
    const disb = await organizationFinanceService.disburse(orgCtx, {
      groupId, amount: 1_000_000, disbursementType: 'seed_capital',
      fundingProgramId: fund.id, purpose: 'On-lending to members',
    });
    if (disb.status === 'pending_approval') {
      await organizationFinanceService.approveDisbursement(approverCtx, disb.id);
    }

    const sources = await listForGroup(groupCtx());
    internalSourceId   = sources.find((s) => s.sourceType === 'internal_savings')!.id;
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
      memberId: borrowerId, principalAmount: principal, interestRate: 10, loanTermMonths: 6,
    } as never);
    await loansService.approve(groupCtx(), loan.id, {} as never);
    return loan.id;
  }

  const disburseArgs = { disbursementDate: new Date().toISOString().slice(0, 10), paymentMethod: 'cash' as const };

  it('defaults to internal savings when no funding plan is given (existing behaviour preserved)', async () => {
    const loanId = await approvedLoan(50_000);
    await loansService.disburse(groupCtx(), loanId, disburseArgs as never);

    const splits = await getLoanFundingSplits(groupCtx(), loanId);
    expect(splits).toHaveLength(1);
    expect(splits[0].sourceType).toBe('internal_savings');
    expect(splits[0].amount).toBe(50_000);
  });

  it("attributes a loan to the organization's allocation when asked", async () => {
    const loanId = await approvedLoan(200_000);
    await loansService.disburse(groupCtx(), loanId, {
      ...disburseArgs,
      fundingPlan: [{ fundingSourceId: allocationSourceId, amount: 200_000 }],
    } as never);

    const splits = await getLoanFundingSplits(groupCtx(), loanId);
    expect(splits).toHaveLength(1);
    expect(splits[0].sourceType).toBe('organization_allocation');
    expect(splits[0].amount).toBe(200_000);
  });

  it('supports a blended loan drawn from both savings and organization capital', async () => {
    const loanId = await approvedLoan(100_000);
    await loansService.disburse(groupCtx(), loanId, {
      ...disburseArgs,
      fundingPlan: [
        { fundingSourceId: allocationSourceId, amount: 60_000 },
        { fundingSourceId: internalSourceId,   amount: 40_000 },
      ],
    } as never);

    const splits = await getLoanFundingSplits(groupCtx(), loanId);
    expect(splits).toHaveLength(2);
    expect(splits.reduce((s, x) => s + x.amount, 0)).toBe(100_000);
    expect(splits.find((s) => s.sourceType === 'organization_allocation')!.amount).toBe(60_000);
    expect(splits.find((s) => s.sourceType === 'internal_savings')!.amount).toBe(40_000);
  });

  it('rejects a plan that does not sum to the principal', async () => {
    const loanId = await approvedLoan(80_000);
    await expect(
      loansService.disburse(groupCtx(), loanId, {
        ...disburseArgs,
        fundingPlan: [{ fundingSourceId: internalSourceId, amount: 79_000 }],
      } as never),
    ).rejects.toThrow(/fully attributed/i);
  });

  it("rejects a plan referencing another group's funding source", async () => {
    const { groupId: other } = await createTestGroup('chairperson');
    const [foreign] = await rawQuery<{ id: string }>(
      `SELECT id FROM group_funding_sources WHERE group_id = $1 AND source_type='internal_savings'`,
      [other],
    );

    const loanId = await approvedLoan(30_000);
    await expect(
      loansService.disburse(groupCtx(), loanId, {
        ...disburseArgs,
        fundingPlan: [{ fundingSourceId: foreign.id, amount: 30_000 }],
      } as never),
    ).rejects.toThrow(/does not belong to this group/i);
  });

  describe('the database invariant (the real enforcement)', () => {
    it('refuses to leave a disbursed loan partly attributed', async () => {
      const loanId = await approvedLoan(60_000);
      await loansService.disburse(groupCtx(), loanId, disburseArgs as never);

      // Deleting a split from a disbursed loan breaks the sum — the deferred
      // constraint trigger must reject it at commit.
      await expect(
        rawQuery(`DELETE FROM loan_funding_splits WHERE loan_id = $1`, [loanId]),
      ).rejects.toThrow();
    });

    it('allows an approved (not yet disbursed) loan to have no splits at all', async () => {
      const loanId = await approvedLoan(25_000);
      const rows = await rawQuery<{ n: string }>(
        `SELECT count(*) AS n FROM loan_funding_splits WHERE loan_id = $1`, [loanId],
      );
      expect(Number(rows[0].n)).toBe(0); // money is not out of the door yet
    });
  });

  describe('organization-side visibility (D5)', () => {
    it('exposes amounts and source, never member identity', async () => {
      const loanId = await approvedLoan(70_000);
      await loansService.disburse(groupCtx(), loanId, {
        ...disburseArgs,
        fundingPlan: [{ fundingSourceId: allocationSourceId, amount: 70_000 }],
      } as never);

      const splits = await getLoanFundingSplits(groupCtx(), loanId);
      const keys = Object.keys(splits[0]);

      // The shape an organization report is built from carries no PII.
      expect(keys).toEqual(expect.arrayContaining(['fundingSourceId', 'amount', 'label', 'sourceType']));
      expect(keys).not.toEqual(expect.arrayContaining(['firstName', 'lastName', 'phone', 'nationalId']));
    });
  });
});
