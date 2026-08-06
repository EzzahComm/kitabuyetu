/**
 * Financial product payload contracts (capital layer Phase 1, migration 116).
 *
 * Every rule asserted here mirrors a CHECK constraint on funding_programs. The
 * DB is the real enforcement; these exist so a bad payload returns a clean 400
 * instead of a raw 23514 from Postgres — and so the two can never drift apart
 * silently, which is the failure mode CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md
 * was written about.
 *
 * The negative cases matter more than the positive ones: they are the evidence
 * that the constraint is actually enforced rather than merely declared.
 */
import {
  CreateProgramSchema,
  CapitalAdjustmentSchema,
  ProgramActionSchema,
  RepaymentWaterfallSchema,
} from '@/lib/validators/organization.schema';

const grant = {
  name: 'Emergency Relief Fund',
  programType: 'grant' as const,
  budget: 500_000,
};

/** The §1 reference scenario's product: EZZAHCOMM's Seed Capital fund. */
const seedCapital = {
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

describe('CreateProgramSchema — non-repayable products (grants)', () => {
  it('accepts a plain grant with no product terms at all', () => {
    expect(CreateProgramSchema.safeParse(grant).success).toBe(true);
  });

  it('defaults to non-repayable, so existing callers are unaffected', () => {
    const parsed = CreateProgramSchema.parse(grant);
    expect(parsed.isRepayable).toBeUndefined();
  });

  it.each([
    ['interest', { interestRateAnnual: 10 }],
    ['an interest method', { interestMethod: 'flat' as const }],
    ['a tenor', { tenorMonths: 12 }],
    ['a repayment frequency', { repaymentFrequency: 'monthly' as const }],
  ])('rejects a grant carrying %s', (_label, extra) => {
    expect(CreateProgramSchema.safeParse({ ...grant, ...extra }).success).toBe(false);
  });
});

describe('CreateProgramSchema — repayable products', () => {
  it('accepts the reference Seed Capital product', () => {
    const result = CreateProgramSchema.safeParse(seedCapital);
    expect(result.success).toBe(true);
  });

  it.each([
    ['repayment frequency', 'repaymentFrequency'],
    ['tenor', 'tenorMonths'],
    ['interest method', 'interestMethod'],
    ['repayment waterfall', 'repaymentWaterfall'],
  ])('rejects a repayable product missing its %s', (_label, field) => {
    const payload: Record<string, unknown> = { ...seedCapital };
    delete payload[field];
    expect(CreateProgramSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects repaymentFrequency 'none' on a repayable product", () => {
    expect(CreateProgramSchema.safeParse({ ...seedCapital, repaymentFrequency: 'none' }).success).toBe(false);
  });

  it("rejects the source spec's 'declining_balance' — the codebase spells it 'reducing_balance'", () => {
    // A second spelling of the same accrual method is precisely what the
    // spec's own D3 forbids; loans_interest_method_check only allows these two.
    expect(CreateProgramSchema.safeParse({ ...seedCapital, interestMethod: 'declining_balance' }).success).toBe(false);
    expect(CreateProgramSchema.safeParse({ ...seedCapital, interestMethod: 'flat' }).success).toBe(true);
  });

  it('treats interestRateAnnual as a percentage, not a 0-1 ratio', () => {
    // 12.5 means 12.5%. A ratio-shaped 0.125 is still a valid number here (it
    // just means 0.125%), so the guard that matters is that a realistic
    // percentage above 1 is accepted — under the spec's numeric(5,4) ratio
    // this would have been impossible.
    expect(CreateProgramSchema.safeParse({ ...seedCapital, interestRateAnnual: 12.5 }).success).toBe(true);
    expect(CreateProgramSchema.safeParse({ ...seedCapital, interestRateAnnual: 36 }).success).toBe(true);
  });
});

describe('CreateProgramSchema — reserved but unimplemented options', () => {
  it.each([
    ['capitalModel pass_through', { capitalModel: 'pass_through' as const }],
    ['lossBearer organization',   { lossBearer: 'organization' as const, sharedLossRatio: undefined }],
    ['lossBearer shared',         { lossBearer: 'shared' as const, sharedLossRatio: 0.5 }],
    ['memberVisibility identified', { memberVisibility: 'identified' as const }],
    ['memberVisibility aggregate',  { memberVisibility: 'aggregate' as const }],
  ])('rejects %s with an explicit message rather than half-working', (_label, extra) => {
    expect(CreateProgramSchema.safeParse({ ...grant, ...extra }).success).toBe(false);
  });

  it('accepts the implemented defaults explicitly', () => {
    expect(CreateProgramSchema.safeParse({
      ...grant, capitalModel: 'liability', lossBearer: 'group', memberVisibility: 'pseudonymous',
    }).success).toBe(true);
  });
});

describe('CreateProgramSchema — shared ratios', () => {
  it("requires revenueShareRatio when revenueOwner is 'shared'", () => {
    expect(CreateProgramSchema.safeParse({ ...grant, revenueOwner: 'shared' }).success).toBe(false);
    expect(CreateProgramSchema.safeParse({ ...grant, revenueOwner: 'shared', revenueShareRatio: 0.3 }).success).toBe(true);
  });

  it("rejects revenueShareRatio when revenueOwner is not 'shared'", () => {
    expect(CreateProgramSchema.safeParse({ ...grant, revenueOwner: 'organization', revenueShareRatio: 0.3 }).success).toBe(false);
  });
});

describe('RepaymentWaterfallSchema', () => {
  it('accepts the documented order', () => {
    expect(RepaymentWaterfallSchema.safeParse({ order: ['penalty', 'interest', 'principal'] }).success).toBe(true);
  });

  it('rejects a repeated component', () => {
    expect(RepaymentWaterfallSchema.safeParse({ order: ['interest', 'interest'] }).success).toBe(false);
  });

  it('rejects an empty order', () => {
    expect(RepaymentWaterfallSchema.safeParse({ order: [] }).success).toBe(false);
  });

  it('requires each revenue_split to sum to exactly 1.0', () => {
    const base = { order: ['interest', 'principal'] };
    expect(RepaymentWaterfallSchema.safeParse({
      ...base, revenue_split: { interest: { organization: 1, group: 0 } },
    }).success).toBe(true);
    expect(RepaymentWaterfallSchema.safeParse({
      ...base, revenue_split: { interest: { organization: 0.5, group: 0.4 } },
    }).success).toBe(false);
  });
});

describe('CapitalAdjustmentSchema / ProgramActionSchema', () => {
  it('requires a positive amount', () => {
    expect(CapitalAdjustmentSchema.safeParse({ amount: 10_000_000 }).success).toBe(true);
    expect(CapitalAdjustmentSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(CapitalAdjustmentSchema.safeParse({ amount: -5 }).success).toBe(false);
  });

  it.each(['capitalize', 'decapitalize'])('accepts the %s action', (action) => {
    expect(ProgramActionSchema.safeParse({ action, amount: 1_000_000 }).success).toBe(true);
  });

  it('rejects an unknown action', () => {
    expect(ProgramActionSchema.safeParse({ action: 'liquidate', amount: 1 }).success).toBe(false);
  });
});
