/**
 * LoanPolicy — the second Configuration Service domain wired end-to-end
 * (ACCOUNTING_ARCHITECTURE_AUDIT.md §29.5/§33.5), following the exact
 * pattern proven by ApprovalPolicy (§29's first domain): a typed wrapper
 * over configuration.service.ts's generic resolvePolicy/setPolicy.
 *
 * Replaces credit-scores.service.ts's hardcoded TIER_THRESHOLDS constant —
 * the literal example §29.6 uses to illustrate "code-driven vs
 * policy-driven" — with a Platform -> Organization -> Group configurable
 * reliability-tier ladder. loan_eligibility_limit (the value this ladder
 * drives) is purely advisory today — no loan-approval code path reads it —
 * so making it configurable changes zero lending-enforcement behavior.
 *
 * Also owns the 'terms' key (default interest rate/method, max term, loan
 * multiplier) — migrated from the retired group_constitutions table by
 * migration 088 (§33.1) as advisory defaults for the loan-application form.
 */
import type { PoolClient } from 'pg';
import { withDb, withTransaction, type TenantContext } from '@/lib/db';
import { resolvePolicy, resolvePolicyDetailed, setPolicy, type PolicySource } from './configuration.service';
import { ValidationError } from '@/lib/utils/errors';

const DOMAIN = 'loan';
const POLICY_KEY = 'tier_thresholds';
const TERMS_KEY  = 'terms';

export type ReliabilityTier = 'excellent' | 'good' | 'fair' | 'poor' | 'high_risk';

export interface TierThreshold {
  tier:           ReliabilityTier;
  min:            number;
  loanMultiplier: number;
}

// Kept identical to migration 087's seed — the defensive floor if a domain
// row is ever missing (should not happen once the migration has run).
const DEFAULT_TIER_THRESHOLDS: TierThreshold[] = [
  { tier: 'excellent', min: 85, loanMultiplier: 10   },
  { tier: 'good',      min: 70, loanMultiplier: 5    },
  { tier: 'fair',      min: 55, loanMultiplier: 3    },
  { tier: 'poor',      min: 40, loanMultiplier: 1    },
  { tier: 'high_risk', min: 0,  loanMultiplier: 0.5  },
];

export interface EffectiveTierThresholds {
  thresholds: TierThreshold[];
  source:     PolicySource;
}

/** Used inline by credit-scores.service.ts — no route/role concerns, just a read. */
export async function getEffectiveTierThresholds(
  client: PoolClient,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<TierThreshold[]> {
  return resolvePolicy<TierThreshold[]>(client, DOMAIN, POLICY_KEY, scope, DEFAULT_TIER_THRESHOLDS);
}

function validateThresholds(thresholds: TierThreshold[]): void {
  const requiredTiers: ReliabilityTier[] = ['excellent', 'good', 'fair', 'poor', 'high_risk'];
  if (thresholds.length !== requiredTiers.length
      || !requiredTiers.every((t) => thresholds.some((th) => th.tier === t))) {
    throw new ValidationError(`Must supply exactly one threshold for each tier: ${requiredTiers.join(', ')}`);
  }
  for (const t of thresholds) {
    if (!(t.min >= 0 && t.min <= 100)) throw new ValidationError(`${t.tier}: min must be between 0 and 100`);
    if (!(t.loanMultiplier >= 0)) throw new ValidationError(`${t.tier}: loanMultiplier must be zero or positive`);
  }
  // Each tier's min must be strictly greater than the next-lowest tier's —
  // checked against requiredTiers' fixed rank order, not just the sorted
  // min values, so a shuffled assignment (e.g. 'fair' outranking
  // 'excellent') is caught even though the raw numbers still sort cleanly.
  const byTier = new Map(thresholds.map((t) => [t.tier, t]));
  for (let i = 1; i < requiredTiers.length; i++) {
    const higher = byTier.get(requiredTiers[i - 1])!;
    const lower  = byTier.get(requiredTiers[i])!;
    if (lower.min >= higher.min) {
      throw new ValidationError(
        `${requiredTiers[i - 1]}'s min (${higher.min}) must be strictly greater than ${requiredTiers[i]}'s min (${lower.min})`,
      );
    }
  }
  if (byTier.get('high_risk')!.min !== 0) {
    throw new ValidationError('high_risk must have min = 0 so every score resolves to a tier');
  }
}

// ─── Loan terms (migrated from the retired group_constitutions table) ────────
// Migration 088 moved group_constitutions' loan fields here (§33.1). These
// are ADVISORY defaults for the loan-application form — officers can still
// set a different rate/term on any individual loan (confirmed product
// decision: advisory, not hard enforcement).

export type InterestMethod = 'flat' | 'reducing_balance';

export interface LoanTerms {
  /**
   * NOMINAL ANNUAL rate, as a percentage. 5 means 5% per year.
   *
   * Stated because it was not, and that cost money. generate_loan_schedule
   * read this as a rate per MONTH until migration 167, and the application
   * form was labelled "%/month" to match — so the engine was self-consistent
   * while every rate a human entered was an annual one. Four live loans were
   * scheduled at twelve times their intended price (KES 349,427 over-stated;
   * caught before any instalment was collected).
   *
   * The unit lives here, in the form label, and in the schedule generator's
   * own comments. Any per-product terms built later must carry it too.
   */
  interestRate:   number;
  interestMethod: InterestMethod;
  maxTermMonths:  number;
  loanMultiplier: number;
  /**
   * The specific lengths a loan may run for, e.g. [1, 3, 6, 12]. Groups do not
   * lend for "any number of months up to the maximum" — they offer a handful of
   * fixed durations, and `maxTermMonths` alone could not express that.
   *
   * Deliberately NOT a product/type entity. Confirmed 2026-08-16: these differ
   * in length ONLY — same rate, same interest method, same limits — so a
   * `loan_products` table would carry one meaningful column and buy nothing.
   * If types ever diverge on rate or eligibility, revisit that decision; the
   * capital layer's funding_programs -> organization_disbursements snapshot
   * (migration 117) is the pattern to copy.
   *
   * Optional so a policy stored before this existed still resolves. Absent
   * means "any term up to maxTermMonths", which is the old behaviour exactly.
   */
  termOptions?:   number[];
}

// Kept identical to migration 088's seed (which itself preserved the
// retired group_constitutions column defaults), plus termOptions, which has
// no migration-088 ancestor — [1,3,6,12] under the same 12-month ceiling.
const DEFAULT_LOAN_TERMS: LoanTerms = {
  interestRate: 10, interestMethod: 'flat', maxTermMonths: 12, loanMultiplier: 3,
  termOptions: [1, 3, 6, 12],
};

export interface EffectiveLoanTerms {
  terms:  LoanTerms;
  source: PolicySource;
}

/** Used inline by loan/credit code paths — no route/role concerns, just a read. */
export async function getEffectiveLoanTerms(
  client: PoolClient,
  scope:  { organizationId?: string | null; groupId?: string | null },
): Promise<LoanTerms> {
  return resolvePolicy<LoanTerms>(client, DOMAIN, TERMS_KEY, scope, DEFAULT_LOAN_TERMS);
}

function validateLoanTerms(terms: LoanTerms): void {
  if (!(terms.interestRate >= 0 && terms.interestRate <= 100)) {
    throw new ValidationError('interestRate must be between 0 and 100');
  }
  if (terms.interestMethod !== 'flat' && terms.interestMethod !== 'reducing_balance') {
    throw new ValidationError("interestMethod must be 'flat' or 'reducing_balance'");
  }
  if (!(Number.isInteger(terms.maxTermMonths) && terms.maxTermMonths >= 1 && terms.maxTermMonths <= 120)) {
    throw new ValidationError('maxTermMonths must be a whole number between 1 and 120');
  }
  if (terms.termOptions !== undefined) {
    if (terms.termOptions.length === 0) {
      throw new ValidationError('termOptions must list at least one term, or be omitted entirely');
    }
    if (terms.termOptions.some((t) => !Number.isInteger(t) || t < 1)) {
      throw new ValidationError('Every term option must be a whole number of months of at least 1');
    }
    // The ceiling has to stay the ceiling. Without this a group could offer an
    // 18-month option while maxTermMonths says 12, and the two halves of the
    // same policy would contradict each other.
    const over = terms.termOptions.filter((t) => t > terms.maxTermMonths);
    if (over.length > 0) {
      throw new ValidationError(
        `Term options ${over.join(', ')} exceed the maximum of ${terms.maxTermMonths} months`,
      );
    }
    if (new Set(terms.termOptions).size !== terms.termOptions.length) {
      throw new ValidationError('termOptions must not repeat a term');
    }
  }
  if (!(terms.loanMultiplier > 0)) {
    throw new ValidationError('loanMultiplier must be positive');
  }
}

export const loanPolicyService = {
  async getGroupPolicy(ctx: TenantContext): Promise<EffectiveTierThresholds> {
    return withDb(ctx, async (client) => {
      const resolved = await resolvePolicyDetailed<TierThreshold[]>(
        client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, DEFAULT_TIER_THRESHOLDS,
      );
      return { thresholds: resolved.value, source: resolved.source };
    });
  },

  /** Access gated at the route (withRole(req, 'chairperson', ...)) — changes scoring for the whole group. */
  async setGroupOverride(ctx: TenantContext, thresholds: TierThreshold[]): Promise<void> {
    validateThresholds(thresholds);
    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, POLICY_KEY, { groupId: ctx.groupId }, thresholds, ctx.userId);
    });
  },

  /** Platform-wide default — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformPolicy(client: PoolClient): Promise<EffectiveTierThresholds> {
    const resolved = await resolvePolicyDetailed<TierThreshold[]>(client, DOMAIN, POLICY_KEY, {}, DEFAULT_TIER_THRESHOLDS);
    return { thresholds: resolved.value, source: resolved.source };
  },

  async setPlatformDefault(userId: string, client: PoolClient, thresholds: TierThreshold[]): Promise<void> {
    validateThresholds(thresholds);
    await setPolicy(client, DOMAIN, POLICY_KEY, {}, thresholds, userId);
  },

  // ─── Loan terms ────────────────────────────────────────────────────────────

  async getGroupTerms(ctx: TenantContext): Promise<EffectiveLoanTerms> {
    return withDb(ctx, async (client) => {
      const resolved = await resolvePolicyDetailed<LoanTerms>(
        client, DOMAIN, TERMS_KEY, { groupId: ctx.groupId }, DEFAULT_LOAN_TERMS,
      );
      return { terms: resolved.value, source: resolved.source };
    });
  },

  /** Access gated at the route (withRole(req, 'chairperson', ...)) — changes the group's default lending terms. */
  async setGroupTermsOverride(ctx: TenantContext, terms: LoanTerms): Promise<void> {
    validateLoanTerms(terms);
    await withTransaction(ctx, async (client) => {
      await setPolicy(client, DOMAIN, TERMS_KEY, { groupId: ctx.groupId }, terms, ctx.userId);
    });
  },

  /** Platform-wide default — super_admin only (enforced at the route via withPlatformRole). */
  async getPlatformTerms(client: PoolClient): Promise<EffectiveLoanTerms> {
    const resolved = await resolvePolicyDetailed<LoanTerms>(client, DOMAIN, TERMS_KEY, {}, DEFAULT_LOAN_TERMS);
    return { terms: resolved.value, source: resolved.source };
  },

  async setPlatformTermsDefault(userId: string, client: PoolClient, terms: LoanTerms): Promise<void> {
    validateLoanTerms(terms);
    await setPolicy(client, DOMAIN, TERMS_KEY, {}, terms, userId);
  },
};
