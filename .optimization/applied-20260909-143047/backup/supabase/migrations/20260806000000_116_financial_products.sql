-- ─────────────────────────────────────────────────────────────────────────────
-- 116: financial products — make funding_programs repayable
--
-- Capital & Investment Layer, Phase 1
-- (docs/capital-layer/capital-layer-spec.md; decisions in impact-report.md §7).
--
-- WHY EXTEND RATHER THAN CREATE
-- The source spec proposed a new `cap_financial_products` table. Phase 0 found
-- `funding_programs` already IS that table — it has budget, disbursed_total,
-- eligibility_criteria jsonb, geographic_coverage, reporting_requirements, and
-- a program_type vocabulary that already includes seed_capital, revolving_fund
-- and loan_capital. What it lacks is REPAYABILITY: interest terms, a tenor, a
-- repayment waterfall, and who bears loss. That is what this migration adds.
--
-- WHAT THIS MIGRATION DOES NOT DO
-- No money moves. No allocation is created. Every existing program stays
-- non-repayable (is_repayable defaults false), so behaviour is unchanged for
-- everything already in flight. Production has 0 funding_programs rows at the
-- time of writing, so this is effectively greenfield.
--
-- DECISIONS ENCODED HERE (impact-report.md §7, all resolved 2026-08-05)
--   D1  capital_model = 'liability'; 'pass_through' reserved, unimplemented
--   D2  loss_bearer   = 'group';     'organization'/'shared' reserved
--   D3  interest_method matches loans_interest_method_check EXACTLY
--       ('flat','reducing_balance') — NOT the spec's 'declining_balance'
--   D4  money is numeric(15,2); interest rate is numeric(5,2) as a PERCENTAGE
--       (matching loans.interest_rate), NOT the spec's numeric(5,4) ratio,
--       which would have differed by 100x and cannot represent a rate >= 10
--   D5  member_visibility = 'pseudonymous'; organizations see member_code /
--       membership_no, never a name or contact field
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.funding_programs
  ADD COLUMN product_code          TEXT,
  ADD COLUMN is_repayable          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN capital_model         TEXT NOT NULL DEFAULT 'liability',
  ADD COLUMN loss_bearer           TEXT NOT NULL DEFAULT 'group',
  ADD COLUMN shared_loss_ratio     NUMERIC(5,4),
  ADD COLUMN interest_method       VARCHAR,
  ADD COLUMN interest_rate_annual  NUMERIC(5,2),
  ADD COLUMN repayment_frequency   TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN grace_period_days     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN tenor_months          INTEGER,
  ADD COLUMN revenue_owner         TEXT NOT NULL DEFAULT 'organization',
  ADD COLUMN revenue_share_ratio   NUMERIC(5,4),
  ADD COLUMN repayment_waterfall   JSONB,
  ADD COLUMN member_visibility     TEXT NOT NULL DEFAULT 'pseudonymous';

COMMENT ON COLUMN public.funding_programs.interest_rate_annual IS
  'Annual interest rate as a PERCENTAGE (12.50 = 12.5%), matching loans.interest_rate. Not a ratio.';
COMMENT ON COLUMN public.funding_programs.member_visibility IS
  'What an organization may see about a borrower. Only ''pseudonymous'' is implemented (member_code/membership_no, never a name or contact field) — widening this is a product + legal decision under the Kenya DPA, not a config change.';
COMMENT ON COLUMN public.funding_programs.budget IS
  'Total capital of the product — a SPENDING AUTHORITY, not a cash balance. Actual cash lives once, at organization_wallets. available = budget - disbursed_total.';

-- ─── Vocabulary constraints ──────────────────────────────────────────────────

ALTER TABLE public.funding_programs
  ADD CONSTRAINT funding_programs_capital_model_check
    CHECK (capital_model IN ('liability', 'pass_through')),
  ADD CONSTRAINT funding_programs_loss_bearer_check
    CHECK (loss_bearer IN ('group', 'organization', 'shared')),
  -- Deliberately identical to loans_interest_method_check. A second spelling of
  -- the same concept ('declining_balance') is exactly what the spec's own D3
  -- forbids, and would silently split the accrual logic in two.
  ADD CONSTRAINT funding_programs_interest_method_check
    CHECK (interest_method IS NULL OR interest_method IN ('flat', 'reducing_balance')),
  ADD CONSTRAINT funding_programs_repayment_frequency_check
    CHECK (repayment_frequency IN ('none', 'weekly', 'monthly', 'quarterly', 'bullet')),
  ADD CONSTRAINT funding_programs_revenue_owner_check
    CHECK (revenue_owner IN ('organization', 'group', 'shared')),
  ADD CONSTRAINT funding_programs_member_visibility_check
    CHECK (member_visibility IN ('pseudonymous', 'aggregate', 'identified')),
  ADD CONSTRAINT funding_programs_grace_period_check
    CHECK (grace_period_days >= 0),
  ADD CONSTRAINT funding_programs_tenor_check
    CHECK (tenor_months IS NULL OR tenor_months > 0),
  ADD CONSTRAINT funding_programs_interest_rate_check
    CHECK (interest_rate_annual IS NULL OR interest_rate_annual >= 0);

-- ─── Coherence constraints ───────────────────────────────────────────────────
-- These are what let the service layer skip a draft->activate "config
-- completeness" step: a repayable product cannot be inserted incomplete.

ALTER TABLE public.funding_programs
  -- A grant cannot carry interest, a tenor, or a repayment schedule.
  ADD CONSTRAINT funding_programs_non_repayable_shape CHECK (
    is_repayable
    OR (interest_rate_annual IS NULL
        AND interest_method IS NULL
        AND tenor_months IS NULL
        AND repayment_frequency = 'none')
  ),
  -- A repayable facility must say how and for how long it is repaid, and how a
  -- repayment is split. Without the waterfall the Phase 4 engine has no config.
  ADD CONSTRAINT funding_programs_repayable_shape CHECK (
    NOT is_repayable
    OR (repayment_frequency <> 'none'
        AND tenor_months IS NOT NULL
        AND interest_method IS NOT NULL
        AND repayment_waterfall IS NOT NULL)
  ),
  ADD CONSTRAINT funding_programs_revenue_share_shape CHECK (
    (revenue_owner = 'shared' AND revenue_share_ratio IS NOT NULL
       AND revenue_share_ratio >= 0 AND revenue_share_ratio <= 1)
    OR (revenue_owner <> 'shared' AND revenue_share_ratio IS NULL)
  ),
  ADD CONSTRAINT funding_programs_shared_loss_shape CHECK (
    (loss_bearer = 'shared' AND shared_loss_ratio IS NOT NULL
       AND shared_loss_ratio >= 0 AND shared_loss_ratio <= 1)
    OR (loss_bearer <> 'shared' AND shared_loss_ratio IS NULL)
  );

-- Product codes are optional, but unique per organization when present.
CREATE UNIQUE INDEX uq_funding_programs_product_code
  ON public.funding_programs (organization_id, product_code)
  WHERE product_code IS NOT NULL;

CREATE INDEX idx_funding_programs_repayable
  ON public.funding_programs (organization_id)
  WHERE is_repayable;

-- ─── Ledger vocabulary ───────────────────────────────────────────────────────
-- organization_ledger is the audit trail for capital movements. Capitalizing a
-- product raises its spending authority (budget); it is NOT a cash event, since
-- cash lives once at organization_wallets and never per-program. So these entry
-- types record authority changes, and deliberately post no GL journal — doing so
-- would unbalance the organization's books against its own wallet.
ALTER TABLE public.organization_ledger
  DROP CONSTRAINT organization_ledger_entry_type_check;

ALTER TABLE public.organization_ledger
  ADD CONSTRAINT organization_ledger_entry_type_check CHECK (
    entry_type IN (
      'deposit', 'disbursement', 'return', 'commitment', 'release',
      'interest', 'fee', 'adjustment',
      'capitalization', 'decapitalization'
    )
  );
