/**
 * Allocation → funding source wiring — capital layer Phase 2a (migration 117).
 *
 * The keystone assertion: when an organization's money settles into a group's
 * books, the group records WHERE it came from. Without that, capital from an
 * organization is indistinguishable from the group's own savings, a member loan
 * funded by it cannot be attributed back, and no organization portfolio
 * reporting is possible.
 *
 * Shaped after the real EZZAHCOMM operation rather than the source spec's
 * template figures: a KES 1,500,000 fund, KES 1,000,000 allocated to a group in
 * CASH (no M-Pesa trail), for on-lending to members.
 */
import type { TenantContext } from '@/lib/db';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { listForGroup } from '@/lib/services/funding-sources.service';
import { createTestOrganization, createTestGroup } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

describe('allocation → group funding source', () => {
  let orgId: string, coordId: string, approverId: string;
  let groupId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId: orgId, coordinatorId: coordId } = await createTestOrganization());
    ({ groupId } = await createTestGroup('chairperson'));

    // A second coordinator: maker-checker forbids self-approval.
    const { coordinatorId: second } = await createTestOrganization();
    approverId = second;
    await rawQuery(
      `INSERT INTO organization_members (organization_id, member_id, org_role, status)
       VALUES ($1, $2, 'lead', 'active') ON CONFLICT DO NOTHING`,
      [orgId, approverId],
    );

    await rawQuery(
      `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
       VALUES ($1, $2, 'read', $3, true) ON CONFLICT DO NOTHING`,
      [orgId, groupId, coordId],
    );
  });

  afterAll(async () => {
    await resetDatabase();
  });

  const orgCtx = (userId: string): TenantContext => ({
    userId, groupId: null, role: 'organization_coordinator', organizationId: orgId,
  } as unknown as TenantContext);

  const groupCtx = (): TenantContext => ({
    userId: coordId, groupId, role: 'chairperson',
  } as unknown as TenantContext);

  it("lets an organization make its FIRST deposit without having opened the wallet screen", async () => {
    // Pre-existing production bug, found by this job: deposit() row-locked the
    // wallet with a helper that THREW when no wallet row existed, and
    // createOrganization() seeds a chart of accounts but not a wallet — only
    // getWallet() creates one, lazily. So an organization's very first deposit
    // failed with "Organization wallet not found" unless a coordinator happened
    // to view the wallet screen first. The live organization in production has
    // no wallet row at all, so this blocked real onboarding.
    const { organizationId, coordinatorId } = await createTestOrganization();
    const freshCtx = {
      userId: coordinatorId, groupId: null,
      role: 'organization_coordinator', organizationId,
    } as unknown as TenantContext;

    const before = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM organization_wallets WHERE organization_id = $1`, [organizationId],
    );
    expect(Number(before[0].n)).toBe(0);

    const { wallet } = await organizationFinanceService.deposit(freshCtx, {
      amount: 1_500_000, source: 'Cash',
    });

    expect(parseFloat(wallet.available_balance)).toBe(1_500_000);
  });

  it('creates an organization_allocation funding source when a cash allocation settles', async () => {
    // The real shape: a 1.5M fund, 1M out to the group, paid in cash.
    const fund = await organizationFinanceService.createProgram(orgCtx(coordId), {
      name: 'Seed Capital', programType: 'seed_capital', budget: 1_500_000,
    });
    await organizationFinanceService.deposit(orgCtx(coordId), { amount: 1_500_000, source: 'Cash' });

    const disb = await organizationFinanceService.disburse(orgCtx(coordId), {
      groupId, amount: 1_000_000, disbursementType: 'seed_capital',
      fundingProgramId: fund.id, purpose: 'On-lending to members',
    });

    // Above the default threshold, so it parks for a second approver.
    if (disb.status === 'pending_approval') {
      await organizationFinanceService.approveDisbursement(orgCtx(approverId), disb.id);
    }

    const sources = await listForGroup(groupCtx());
    const allocationSource = sources.find((s) => s.sourceType === 'organization_allocation');

    expect(allocationSource).toBeDefined();
    expect(allocationSource!.allocationId).toBe(disb.id);
    expect(allocationSource!.organizationId).toBe(orgId);
    expect(allocationSource!.status).toBe('active');
    // A grant-funded allocation is not a debt; repayability comes from the product.
    expect(allocationSource!.isRepayable).toBe(false);
  });

  it("leaves the group's internal savings source intact alongside it", async () => {
    const sources = await listForGroup(groupCtx());

    expect(sources.some((s) => s.sourceType === 'internal_savings')).toBe(true);
    expect(sources.some((s) => s.sourceType === 'organization_allocation')).toBe(true);
    // Internal savings sorts first — it is the default funding source for a
    // member loan when no explicit funding plan is given.
    expect(sources[0].sourceType).toBe('internal_savings');
  });

  it('assigns a human-readable allocation code', async () => {
    const rows = await rawQuery<{ allocation_code: string }>(
      `SELECT allocation_code FROM organization_disbursements WHERE group_id = $1 LIMIT 1`,
      [groupId],
    );
    expect(rows[0].allocation_code).toMatch(/^ALC-\d{4}-\d{6}$/);
  });

  it('is idempotent — re-settling does not duplicate the funding source', async () => {
    const before = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM group_funding_sources
       WHERE group_id = $1 AND source_type = 'organization_allocation'`,
      [groupId],
    );

    // settleOrgDisbursement only transitions rows still 'approved', so this is
    // a no-op; the ON CONFLICT guard covers the case where it is not.
    const [disb] = await rawQuery<{ id: string }>(
      `SELECT id FROM organization_disbursements WHERE group_id = $1 LIMIT 1`, [groupId],
    );
    await organizationFinanceService.approveDisbursement(orgCtx(approverId), disb.id).catch(() => {});

    const after = await rawQuery<{ n: string }>(
      `SELECT count(*) AS n FROM group_funding_sources
       WHERE group_id = $1 AND source_type = 'organization_allocation'`,
      [groupId],
    );
    expect(after[0].n).toBe(before[0].n);
  });

  it('snapshots repayable terms onto the allocation, not a live join to the product', async () => {
    const { groupId: g2 } = await createTestGroup('chairperson');
    await rawQuery(
      `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
       VALUES ($1, $2, 'read', $3, true) ON CONFLICT DO NOTHING`,
      [orgId, g2, coordId],
    );

    const facility = await organizationFinanceService.createProgram(orgCtx(coordId), {
      name: 'Revolving Facility', programType: 'revolving_fund', budget: 400_000,
      isRepayable: true, interestMethod: 'reducing_balance', interestRateAnnual: 12.5,
      repaymentFrequency: 'monthly', tenorMonths: 12,
      repaymentWaterfall: { order: ['penalty', 'interest', 'principal'] },
    });
    await organizationFinanceService.deposit(orgCtx(coordId), { amount: 400_000, source: 'Cash' });

    const disb = await organizationFinanceService.disburse(orgCtx(coordId), {
      groupId: g2, amount: 300_000, disbursementType: 'revolving_fund', fundingProgramId: facility.id,
    });
    if (disb.status === 'pending_approval') {
      await organizationFinanceService.approveDisbursement(orgCtx(approverId), disb.id);
    }

    const [row] = await rawQuery<{
      is_repayable: boolean; interest_rate_annual: string | null;
      repayment_frequency: string | null; tenor_months: number | null; maturity_date: string | null;
    }>(
      `SELECT is_repayable, interest_rate_annual, repayment_frequency, tenor_months, maturity_date
       FROM organization_disbursements WHERE id = $1`, [disb.id],
    );

    expect(row.is_repayable).toBe(true);
    expect(parseFloat(row.interest_rate_annual!)).toBe(12.5);
    expect(row.repayment_frequency).toBe('monthly');
    expect(row.tenor_months).toBe(12);
    expect(row.maturity_date).toBeTruthy();

    // Repricing the product must NOT change the existing allocation.
    await rawQuery(`UPDATE funding_programs SET interest_rate_annual = 30 WHERE id = $1`, [facility.id]);
    const [after] = await rawQuery<{ interest_rate_annual: string }>(
      `SELECT interest_rate_annual FROM organization_disbursements WHERE id = $1`, [disb.id],
    );
    expect(parseFloat(after.interest_rate_annual)).toBe(12.5);

    // And the group-side source reflects that this money is a debt.
    const g2Sources = await rawQuery<{ is_repayable: boolean }>(
      `SELECT is_repayable FROM group_funding_sources
       WHERE group_id = $1 AND source_type = 'organization_allocation'`, [g2],
    );
    expect(g2Sources[0].is_repayable).toBe(true);
  });

  describe('processing fee (migration 125) — deducted from what\'s disbursed', () => {
    it('nets the fee out of wallet cash while the group owes the full gross principal', async () => {
      const { groupId: g3 } = await createTestGroup('chairperson');
      await rawQuery(
        `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
         VALUES ($1, $2, 'read', $3, true) ON CONFLICT DO NOTHING`,
        [orgId, g3, coordId],
      );

      const fund = await organizationFinanceService.createProgram(orgCtx(coordId), {
        name: 'Fee-bearing Seed Capital', programType: 'seed_capital', budget: 1_500_000,
        isRepayable: true, interestMethod: 'flat', interestRateAnnual: 120,
        repaymentFrequency: 'weekly', tenorMonths: 1,
        repaymentWaterfall: { order: ['penalty', 'interest', 'principal'] },
        processingFeePct: 3,
      });
      await organizationFinanceService.deposit(orgCtx(coordId), { amount: 1_500_000, source: 'Cash' });

      const before = await organizationFinanceService.getWallet(orgCtx(coordId));

      // 1,030,928 grossed up so the NET lands at exactly 1,000,000 — the same
      // trap flagged to the user: entering 1,000,000 under a 3% fee only
      // nets 970,000, so a real operator entering "The Fionas get 1,000,000
      // cash" must gross up. This test proves the math, not the UI prompt.
      const disb = await organizationFinanceService.disburse(orgCtx(coordId), {
        groupId: g3, amount: 1_030_928, disbursementType: 'seed_capital',
        fundingProgramId: fund.id, purpose: 'On-lending to members',
      });
      if (disb.status === 'pending_approval') {
        await organizationFinanceService.approveDisbursement(orgCtx(approverId), disb.id);
      }

      const [row] = await rawQuery<{
        amount: string; processing_fee_pct: string; processing_fee_amount: string;
        net_disbursed_amount: string;
      }>(
        `SELECT amount, processing_fee_pct, processing_fee_amount, net_disbursed_amount
         FROM organization_disbursements WHERE id = $1`, [disb.id],
      );
      expect(parseFloat(row.processing_fee_pct)).toBe(3);
      // 1,030,928 * 3% = 30,927.84
      expect(parseFloat(row.processing_fee_amount)).toBeCloseTo(30_927.84, 2);
      // Grossed-up amount minus the fee lands almost exactly on 1,000,000.
      expect(parseFloat(row.net_disbursed_amount)).toBeCloseTo(1_000_000.16, 2);

      // Wallet: net change in available_balance across request + settle is
      // exactly -net (the fee portion never really left).
      const after = await organizationFinanceService.getWallet(orgCtx(coordId));
      const walletDelta = parseFloat(before.available_balance) - parseFloat(after.available_balance);
      expect(walletDelta).toBeCloseTo(parseFloat(row.net_disbursed_amount), 2);
      expect(parseFloat(after.committed_balance)).toBe(0);

      // Group's own cash account reflects NET, not gross — the fee never
      // reached the group.
      const [groupCash] = await rawQuery<{ debit: string }>(
        `SELECT jl.debit FROM journal_lines jl
         JOIN accounts a ON a.id = jl.account_id
         WHERE jl.group_id = $1 AND a.account_code = '1001'
         ORDER BY jl.created_at DESC LIMIT 1`,
        [g3],
      );
      expect(parseFloat(groupCash.debit)).toBeCloseTo(parseFloat(row.net_disbursed_amount), 2);

      // The fee itself is recorded as an audit-trail ledger row.
      const [feeEntry] = await rawQuery<{ direction: string; amount: string }>(
        `SELECT direction, amount FROM organization_ledger
         WHERE disbursement_id = $1 AND entry_type = 'fee'`, [disb.id],
      );
      expect(feeEntry.direction).toBe('credit');
      expect(parseFloat(feeEntry.amount)).toBeCloseTo(30_927.84, 2);
    });

    it('a grant (non-repayable) can still carry a processing fee', async () => {
      const { groupId: g4 } = await createTestGroup('chairperson');
      await rawQuery(
        `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
         VALUES ($1, $2, 'read', $3, true) ON CONFLICT DO NOTHING`,
        [orgId, g4, coordId],
      );

      const grant = await organizationFinanceService.createProgram(orgCtx(coordId), {
        name: 'Fee-bearing Grant', programType: 'grant', budget: 200_000,
        processingFeePct: 2,
      });
      await organizationFinanceService.deposit(orgCtx(coordId), { amount: 200_000, source: 'Cash' });

      const disb = await organizationFinanceService.disburse(orgCtx(coordId), {
        groupId: g4, amount: 50_000, disbursementType: 'grant', fundingProgramId: grant.id,
      });
      if (disb.status === 'pending_approval') {
        await organizationFinanceService.approveDisbursement(orgCtx(approverId), disb.id);
      }

      const [row] = await rawQuery<{ is_repayable: boolean; processing_fee_amount: string }>(
        `SELECT is_repayable, processing_fee_amount FROM organization_disbursements WHERE id = $1`, [disb.id],
      );
      expect(row.is_repayable).toBe(false);
      expect(parseFloat(row.processing_fee_amount)).toBe(1_000); // 50,000 * 2%
    });

    it('a product with no fee configured disburses at net === gross, unchanged from pre-125 behaviour', async () => {
      const { groupId: g5 } = await createTestGroup('chairperson');
      await rawQuery(
        `INSERT INTO organization_group_access (organization_id, group_id, access_level, granted_by, is_active)
         VALUES ($1, $2, 'read', $3, true) ON CONFLICT DO NOTHING`,
        [orgId, g5, coordId],
      );

      const fund = await organizationFinanceService.createProgram(orgCtx(coordId), {
        name: 'No Fee Fund', programType: 'grant', budget: 100_000,
      });
      await organizationFinanceService.deposit(orgCtx(coordId), { amount: 100_000, source: 'Cash' });

      const disb = await organizationFinanceService.disburse(orgCtx(coordId), {
        groupId: g5, amount: 40_000, disbursementType: 'grant', fundingProgramId: fund.id,
      });
      if (disb.status === 'pending_approval') {
        await organizationFinanceService.approveDisbursement(orgCtx(approverId), disb.id);
      }

      const [row] = await rawQuery<{ amount: string; net_disbursed_amount: string; processing_fee_amount: string }>(
        `SELECT amount, net_disbursed_amount, processing_fee_amount FROM organization_disbursements WHERE id = $1`,
        [disb.id],
      );
      expect(parseFloat(row.processing_fee_amount)).toBe(0);
      expect(parseFloat(row.net_disbursed_amount)).toBe(parseFloat(row.amount));
    });
  });
});
