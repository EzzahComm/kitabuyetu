import { z } from 'zod';

// Shared with app/api/v1/organization/programs/route.ts and
// app/api/v1/organization/disbursements/route.ts — a single source so a
// client dropdown can never drift from what the server actually accepts
// (this file used to have three independent copies of DISBURSEMENT_TYPES
// and two of PROGRAM_TYPES, one of them missing 'insurance'/'investment').
export const PROGRAM_TYPES = [
  'grant',
  'revolving_fund',
  'loan_capital',
  'matching_contribution',
  'seed_capital',
  'emergency_support',
  'operational_support',
  'scholarship',
  'insurance',
  'investment',
] as const;

export const DISBURSEMENT_TYPES = [
  'grant',
  'revolving_fund',
  'loan_capital',
  'matching_contribution',
  'seed_capital',
  'emergency_support',
  'operational_support',
] as const;

// ─── Financial product terms (capital layer Phase 1, migration 116) ──────────
// Every vocabulary below mirrors a CHECK constraint on funding_programs. Keep
// them in lockstep: the DB is the real enforcement, these exist so a bad
// payload returns a clean 400 instead of a raw 23514 from Postgres.

/** Matches loans_interest_method_check EXACTLY — not the source spec's 'declining_balance'. */
export const INTEREST_METHODS = ['flat', 'reducing_balance'] as const;
export const REPAYMENT_FREQUENCIES = ['none', 'weekly', 'monthly', 'quarterly', 'bullet'] as const;
export const CAPITAL_MODELS = ['liability', 'pass_through'] as const;
export const LOSS_BEA���q�^