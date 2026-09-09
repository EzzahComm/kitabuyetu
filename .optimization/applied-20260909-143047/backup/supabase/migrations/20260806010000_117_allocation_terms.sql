-- ─────────────────────────────────────────────────────────────────────────────
-- 117: allocation terms — make an org→group disbursement a real ALLOCATION
--
-- Capital & Investment Layer, Phase 2a
-- (docs/capital-layer/capital-layer-spec.md §3.2).
--
-- WHY EXTEND organization_disbursements
-- Phase 0 found this table already IS the spec's proposed cap_allocations: it
-- has maker-checker (chk_org_disb_maker_checker: approved_by <> created_by), a
-- status machine, funding_program_id, group_id, amount, and links to both
-- sides' journals. What it lacks is TERMS — whether the money must come back,
-- and on what schedule.
--
-- SNAPSHOT DISCIPLINE (the spec is emphatic and correct about this)
-- The terms below are copied FROM the product AT disbursement time and then
-- never re-read. Repricing a product must never retroactively change what an
-- existing borrower owes. That is why these are columns here rather than a
-- join back to funding_programs.
--
-- WHAT THIS ENABLES
-- Settling an allocation can now create the matching group_funding_sources row
-- (migration 115), which is what finally lets a member loan be attributed back
-- to an organization's capital instead of defaulting to the group's own
-- savings. That attribution is the keystone the whole capital layer rests on.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organization_disbursements
  ADD COLUMN allocation_code       TEXT,
  ADD COLUMN purpose               TEXT,
  ADD COLUMN is_repayable          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN interest_rate_annual  NUMERIC(5,2),
  ADD COLUMN repayment_frequency   TEXT,
  ADD COLUMN tenor_months          INTEGER,
  ADD COLUMN first_repayment_date  DATE,
  ADD COLUMN maturity_date         DATE;

COMMENT ON COLUMN public.organization_disbursements.interest_rate_annual IS
  'SNAPSHOT of the product rate at disbursement, as a PERCENTAGE (12.50 = 12.5%). Never re-read from funding_programs — repricing a product must not alter an existing allocation.';
COMMENT ON COLUMN public.organization_disbursements.allocation_code IS
  'Human-readable allocation reference, e.g. ALC-2026-000148. Assigned by trigger.';

ALTER TABLE public.organization_disbursements
  ADD CONSTRAINT org_disb_repayment_frequency_check
    CHECK (repayment_frequency IS NULL
           OR repayment_frequency IN ('none', 'weekly', 'monthly', 'quarterly', 'bullet')),
  ADD CONSTRAINT org_disb_tenor_check
    CHECK (tenor_months IS NULL OR tenor_months > 0),
  ADD CONSTRAINT org_disb_interest_rate_check
    CHECK (interest_rate_annual IS NULL OR interest_rate_annual >= 0),
  -- Mirrors funding_programs_repayable_shape: a repayable allocation must
  -- carry the terms it will be repaid under, or nothing downstream can build a
  -- schedule from it.
  ADD CONSTRAINT org_disb_repayable_shape CHECK (
    NOT is_repayable
    OR (repayment_frequency IS NOT NULL AND repayment_frequency <> 'none'
        AND tenor_months IS NOT NULL)
  ),
  ADD CONSTRAINT org_disb_non_repayable_shape CHECK (
    is_repayable
    OR (interest_rate_annual IS NULL AND tenor_months IS NULL
        AND first_repayment_date IS NULL AND maturity_date IS NULL)
  );

CREATE UNIQUE INDEX uq_org_disb_allocation_code
  ON public.organization_disbursements (allocation_code)
  WHERE allocation_code IS NOT NULL;

CREATE INDEX idx_org_disb_repayable
  ON public.organization_disbursements (organization_id)
  WHERE is_repayable;

-- ─── Allocation codes ────────────────────────────────────────────────────────
-- Sequence + trigger rather than app-side generation: concurrent-safe by
-- construction, and follows this schema's existing precedent for
-- human-readable identifiers (group_code, member_code, payment_prefix are all
-- assigned in the database, never by the caller).

CREATE SEQUENCE IF NOT EXISTS public.allocation_code_seq;

CREATE OR REPLACE FUNCTION private.assign_allocation_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.allocation_code IS NULL THEN
    NEW.allocation_code := 'ALC-'
      || to_char(COALESCE(NEW.created_at, NOW()), 'YYYY')
      || '-'
      || lpad(nextval('public.allocation_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_org_disb_allocation_code
  BEFORE INSERT ON public.organization_disbursements
  FOR EACH ROW EXECUTE FUNCTION private.assign_allocation_code();

-- Backfill any pre-existing rows so the column is uniformly populated.
-- (Production has 0 rows at the time of writing; this is for other
-- environments and for correctness if that changes before this is applied.)
UPDATE public.organization_disbursements
SET    allocation_code = 'ALC-'
       || to_char(created_at, 'YYYY') || '-'
       || lpad(nextval('public.allocation_code_seq')::text, 6, '0')
WHERE  allocation_code IS NULL;
