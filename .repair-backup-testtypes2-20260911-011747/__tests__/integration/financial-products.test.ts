/**
 * Financial products — capital layer Phase 1 (migration 116), real Postgres.
 *
 * The headline test is the source spec's own §1 reference scenario, reduced to
 * the part Phase 1 can satisfy: EZZAHCOMM's Seed Capital product capitalized to
 * KES 10,000,000 must report available 10,000,000 / allocated 0. (The
 * KES 1,000,000 allocation to The Fionas out of that fund is Phase 2 — there is
 * no allocation lifecycle yet.)
 *
 * Everything else here pins a DB CHECK constraint. Those are the real
 * enforcement — the Zod layer in organization.schema.ts only exists to turn
 * them into clean 400s — so they are asserted directly against Postgres rather
 * than trusted from the validator's unit tests.
 */
import type { TenantContext } from '@/lib/db';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { createTestOrganization } from './helpers/fixtures';
import { resetDatabase } from './helpers/cleanup';
import { rawQuery } from './helpers/db';

describe('financial products', () => {
  let orgAId: string, coordAId: string;
  let orgBId: string, coordBId: string;

  beforeAll(async () => {
    await resetDatabase();
    ({ organizationId: orgAId, coordinatorId: coordAId } = await createTestOrganization());
    ({ organizationId: orgBId, coordinatorId: coordBId } = await createTestOrganization());
  });

  afterAll(async () => {
    await resetDatabase();
  });

  const ctxA = (): TenantContext => ({
    userId: coordAId, groupId: null, role: 'organization_coordinator', organizationId: orgAId,
  } as unknown as TenantContext);
  const ctxB = (): TenantContext => ({
    userId: coordBId, groupId: null, role: 'organization_coordinator', organizationId: orgBId,
  } as unknown as TenantContext);

  const seedCapitalInput = {
    name: 'Seed Capital',
    programType: 'seed_capital' as const,
    budget: 10_000_000,
    isRepayable: true,
    interestMethod: 'reducing_balance' as const,
    interestRateAnnual: 12.5,
    repaymentFrequency: 'monthly' as const,
    tenorMonths: 12,
    repaymentWaterfall: { order: ['penalty', 'interest', 'principal'] as const },
  };

  describe('§1 reference scenario — EZZAHCOMM Seed Capital', () => {
    it('reports available 10,000,000 / allocated 0 for a product capitalized to 10,000,000', async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), seedCapitalInput);

      const [balances] = await organizationFinanceService.productBalances(ctxA(), product.id);

      expect(balances.totalCapital).toBe(10_000_000);
      expect(balances.allocated).toBe(0);
      expect(balances.available).toBe(10_000_000);
      expect(balances.utilizationRate).toBe(0);
      expect(balances.isRepayable).toBe(true);
    });

    it('persists the product terms as given, with the rate as a percentage', async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), {
        ...seedCapitalInput, name: 'Seed Capital II',
      });

      expect(product.is_repayable).toBe(true);
      expect(product.interest_method).toBe('reducing_balance');
      // 12.5 means 12.5% — stored numeric(5,2), NOT a 0-1 ratio.
      expect(parseFloat(product.interest_rate_annual!)).toBe(12.5);
      expect(product.repayment_frequency).toBe('monthly');
      expect(product.tenor_months).toBe(12);
      expect(product.capital_model).toBe('liability');
      expect(product.member_visibility).toBe('pseudonymous');
    });
  });

  describe('capitalize / decapitalize', () => {
    it('raises available capital and records a ledger entry', async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), {
        name: 'Revolving Fund', programType: 'revolving_fund', budget: 1_000_000,
      });

      await organizationFinanceService.capitalizeProduct(ctxA(), product.id, {
        amount: 4_000_000, notes: 'Q3 top-up',
      });

      const [balances] = await organizationFinanceService.productBalances(ctxA(), product.id);
      expect(balances.totalCapital).toBe(5_000_000);
      expect(balances.available).toBe(5_000_000);

      const ledger = await rawQuery<{ entry_type: string; direction: string; amount: string }>(
        `SELECT entry_type, direction, amount FROM organization_ledger
         WHERE funding_program_id = $1 AND entry_type = 'capitalization'`,
        [product.id],
      );
      expect(ledger).toHaveLength(1);
      expect(ledger[0].direction).toBe('credit');
      expect(parseFloat(ledger[0].amount)).toBe(4_000_000);
    });

    it('lowers capital and records a decapitalization entry', async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), {
        name: 'Overfunded Fund', programType: 'grant', budget: 2_000_000,
      });

      await organizationFinanceService.decapitalizeProduct(ctxA(), product.id, { amount: 500_000 });

      const [balances] = await organizationFinanceService.productBalances(ctxA(), product.id);
      expect(balances.totalCapital).toBe(1_500_000);

      const ledger = await rawQuery<{ direction: string }>(
        `SELECT direction FROM organization_ledger
         WHERE funding_program_id = $1 AND entry_type = 'decapitalization'`,
        [product.id],
      );
      expect(ledger[0].direction).toBe('debit');
    });

    it('does NOT move wallet cash — capitalization is a spending authority, not a cash event', async () => {
      const before = await organizationFinanceService.getWallet(ctxA());

      const product = await organizationFinanceService.createProgram(ctxA(), {
        name: 'Authority Only', programType: 'grant', budget: 100_000,
      });
      await organizationFinanceService.capitalizeProduct(ctxA(), product.id, { amount: 900_000 });

      const after = await organizationFinanceService.getWallet(ctxA());
      expect(parseFloat(after.available_balance)).toBe(parseFloat(before.available_balance));
      expect(parseFloat(after.total_deposited)).toBe(parseFloat(before.total_deposited));
    });

    it('refuses to withdraw more than the uncommitted capital', async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), {
        name: 'Tight Fund', programType: 'grant', budget: 100_000,
      });

      await expect(
        organizationFinanceService.decapitalizeProduct(ctxA(), product.id, { amount: 150_000 }),
      ).rejects.toThrow(/uncommitted/i);
    });

    it('works for an organization that has never opened a wallet', async () => {
      // createOrganization() seeds a chart of accounts but NOT a wallet — the
      // wallet is created lazily. Capitalization needs one only to satisfy
      // organization_ledger.wallet_id NOT NULL, since no cash moves, so it must
      // bootstrap rather than fail. Without that, capitalizing a product for
      // any freshly created organization threw "Organization wallet not found".
      const { organizationId, coordinatorId } = await createTestOrganization();
      const freshCtx = {
        userId: coordinatorId, groupId: null,
        role: 'organization_coordinator', organizationId,
      } as unknown as TenantContext;

      const walletsBefore = await rawQuery<{ n: string }>(
        `SELECT count(*) AS n FROM organization_wallets WHERE organization_id = $1`, [organizationId],
      );
      expect(Number(walletsBefore[0].n)).toBe(0);

      const product = await organizationFinanceService.createProgram(freshCtx, {
        name: 'Fresh Org Fund', programType: 'seed_capital', budget: 1_000_000,
      });

      await expect(
        organizationFinanceService.capitalizeProduct(freshCtx, product.id, { amount: 9_000_000 }),
      ).resolves.toBeDefined();

      const [balances] = await organizationFinanceService.productBalances(freshCtx, product.id);
      expect(balances.totalCapital).toBe(10_000_000);
    });

    it('rejects a non-positive adjustment', async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), {
        name: 'Zero Fund', programType: 'grant', budget: 100_000,
      });

      await expect(
        organizationFinanceService.capitalizeProduct(ctxA(), product.id, { amount: 0 }),
      ).rejects.toThrow(/positive/i);
    });
  });

  describe('DB CHECK constraints (the real enforcement)', () => {
    async function insertRaw(cols: string, vals: string, params: unknown[]): Promise<void> {
      await rawQuery(
        `INSERT INTO funding_programs (organization_id, name, program_type, budget, status, ${cols})
         VALUES ($1, 'Raw Test', 'grant', 1000, 'active', ${vals})`,
        [orgAId, ...params],
      );
    }

    it('rejects a repayable product with no tenor or waterfall', async () => {
      await expect(
        insertRaw('is_repayable, interest_method, repayment_frequency', 'true, $2, $3', ['flat', 'monthly']),
      ).rejects.toThrow();
    });

    it('rejects a non-repayable product carrying interest', async () => {
      await expect(
        insertRaw('is_repayable, interest_rate_annual', 'false, $2', [10]),
      ).rejects.toThrow();
    });

    it("rejects an interest_method the loans engine doesn't use", async () => {
      await expect(
        insertRaw('interest_method', '$2', ['declining_balance']),
      ).rejects.toThrow();
    });

    it('rejects an unknown member_visibility', async () => {
      await expect(insertRaw('member_visibility', '$2', ['public'])).rejects.toThrow();
    });

    it('rejects a shared loss bearer with no ratio', async () => {
      await expect(insertRaw('loss_bearer', '$2', ['shared'])).rejects.toThrow();
    });

    it('enforces product_code uniqueness per organization, but allows reuse across organizations', async () => {
      await rawQuery(
        `INSERT INTO funding_programs (organization_id, name, program_type, budget, status, product_code)
         VALUES ($1,'Coded A','grant',1000,'active','SEED-01')`, [orgAId],
      );
      await expect(
        rawQuery(
          `INSERT INTO funding_programs (organization_id, name, program_type, budget, status, product_code)
           VALUES ($1,'Coded A dup','grant',1000,'active','SEED-01')`, [orgAId],
        ),
      ).rejects.toThrow();
      // Same code under a different organization is fine.
      await expect(
        rawQuery(
          `INSERT INTO funding_programs (organization_id, name, program_type, budget, status, product_code)
           VALUES ($1,'Coded B','grant',1000,'active','SEED-01')`, [orgBId],
        ),
      ).resolves.toBeDefined();
    });

    it('still accepts capitalization/decapitalization ledger entry types', async () => {
      const rows = await rawQuery<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'organization_ledger_entry_type_check'`,
      );
      expect(rows[0].def).toContain('capitalization');
      expect(rows[0].def).toContain('decapitalization');
    });
  });

  describe('cross-organization isolation', () => {
    it("organization B cannot see or capitalize organization A's products", async () => {
      const product = await organizationFinanceService.createProgram(ctxA(), {
        name: 'A Private Fund', programType: 'grant', budget: 750_000,
      });

      const bBalances = await organizationFinanceService.productBalances(ctxB());
      expect(bBalances.some((p) => p.programId === product.id)).toBe(false);

      await expect(
        organizationFinanceService.capitalizeProduct(ctxB(), product.id, { amount: 1_000 }),
      ).rejects.toThrow();
    });
  });
});
