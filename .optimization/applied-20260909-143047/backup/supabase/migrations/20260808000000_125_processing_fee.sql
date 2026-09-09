-- ─────────────────────────────────────────────────────────────────────────────
-- 125: processing fee — deducted from what's disbursed
--
-- Decision (2026-08-08, discussed alongside the EZZAHCOMM fund's own terms):
-- a product may charge a processing fee, expressed as a percentage of the
-- allocated amount. Semantics are "deducted from what's disbursed" — the
-- group's loan principal (organization_disbursements.amount) is unchanged and
-- is what the group owes back; the CASH that actually leaves the org wallet is
-- amount - fee. The fee never leaves the org — it converts straight to
-- retained income, released back into organization_wallets.available_balance
-- at settlement (see the settleOrgDisbursement wallet UPDATE, application
-- code, same commit as this migration).
--
-- SNAPSHOT DISCIPLINE, identical to migration 117: the rate is configured on
-- the product (funding_programs.processing_fee_pct) and copied onto the
-- allocation at disbursement time (organization_disbursements.processing_
-- fee_pct) — never re-read. Repricing a product must not retroactively change
-- what an existing allocation already charged.
--
-- INDEPENDENT OF is_repayable: a fee can apply to a grant too (an
-- administrative/processing charge is a different concept from interest on
-- repayable capital), so this does not follow funding_programs_repayable_
-- shape's pattern of nulling non-repayable fields.
--
-- NO PRE-MIGRATION ASSERTION BLOCK: additive, and organization_disbursements
-- has 0 production rows today (verified this session), so the DEFAULT 0 on
-- the two new organization_disbursements columns is not a stand-in for any
-- real row's history.
--
-- organization_ledger.entry_type already includes 'fee' (migration 116,
-- unused until now) — no widening needed.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.funding_programs
  ADD COLUMN processing_fee_pct NUMERIC(5,2)
    CHECK (processing_fee_pct IS NULL OR (processing_fee_pct >= 0 AND processing_fee_pct <= 100));

COMMENT ON COLUMN public.funding_programs.processing_fee_pct IS
  'Percentage of the allocated amount retained by the organization at disbursement, deducted from what actually leaves the wallet (the group''s principal/what they owe is unaffected). NULL means no fee. See migration 125.';

ALTER TABLE public.organization_disbursements
  ADD COLUMN processing_fee_pct    NUMERIC(5,2),
  ADD COLUMN processing_fee_amount NUMERIC(15,2) NOT NULL DEFAULT 0
    CHECK (processing_fee_amount >= 0 AND processing_fee_amount <= amount),
  ADD COLUMN net_disbursed_amount  NUMERIC(15,2) NOT NULL DEFAULT 0
    CHECK (net_disbursed_amount >= 0 AND net_disbursed_amount <= amount);

COMMENT ON COLUMN public.organization_disbursements.processing_fee_pct IS
  'SNAPSHOT of the product''s processing_fee_pct at disbursement time. Never re-read from funding_programs.';
COMMENT ON COLUMN public.organization_disbursements.processing_fee_amount IS
  'Computed once at disbursement: amount * processing_fee_pct / 100. Retained by the organization — never leaves the wallet.';
COMMENT ON COLUMN public.organization_disbursements.net_disbursed_amount IS
  'amount - processing_fee_amount. The actual cash that leaves organization_wallets and lands in the group''s own cash account — this is what the group-side journal entry uses, not the gross amount.';
