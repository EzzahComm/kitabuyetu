-- ─────────────────────────────────────────────────────────────────────────────
-- 118: loan_funding_splits — attribute every member loan to its funding source
--
-- Capital & Investment Layer, Phase 3. THE KEYSTONE.
--
-- The source spec puts it plainly: "Every shilling in a group must be
-- attributable to a funding source, and every member loan must be attributable
-- to one or more funding sources. A loan may be blended. Attribution is what
-- makes organization-side reporting possible; it is not optional."
--
-- Concretely, this is what lets the platform tell the difference between
--   "The Fionas lent their own savings to a member"
-- and
--   "The Fionas on-lent EZZAHCOMM's capital to a member"
-- which are the same row in `loans` today. Without it, an organization can
-- never see what became of its money, and a group's own equity is
-- indistinguishable from a liability it owes upstream.
--
-- BLENDING IS THE NORMAL CASE, not an edge case: a group with both internal
-- savings and an organization allocation will fund a single loan from both, so
-- this is a one-loan-to-many-sources table rather than a column on `loans`.
--
-- THE INVARIANT
-- For any loan that has actually been disbursed, its splits must sum to exactly
-- its principal. Enforced by DEFERRED constraint triggers so the service layer
-- can insert the loan and its splits in either order within one transaction —
-- the same technique migration 027 uses for journal-entry balance.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.loan_funding_splits (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  loan_id           UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
  funding_source_id UUID NOT NULL REFERENCES public.group_funding_sources(id) ON DELETE RESTRICT,
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per (loan, source). A loan draws a single amount from each source;
  -- two rows for the same pair would be an accounting duplicate, not a blend.
  CONSTRAINT uq_loan_funding_splits UNIQUE (loan_id, funding_source_id)
);

CREATE INDEX idx_loan_funding_splits_loan   ON public.loan_funding_splits (loan_id);
CREATE INDEX idx_loan_funding_splits_source ON public.loan_funding_splits (funding_source_id);
CREATE INDEX idx_loan_funding_splits_group  ON public.loan_funding_splits (group_id, loan_id);

CREATE TRIGGER trg_loan_funding_splits_updated_at
  BEFORE UPDATE ON public.loan_funding_splits
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

COMMENT ON TABLE public.loan_funding_splits IS
  'Which funding source(s) financed a member loan, and how much from each. Splits must sum to the loan principal once disbursed. See docs/capital-layer/capital-layer-spec.md.';

-- ─── The invariant ───────────────────────────────────────────────────────────
-- Statuses at or past disbursement. A loan still pending or approved has no
-- money out of the door yet, so it legitimately has no splits.
CREATE OR REPLACE FUNCTION private.assert_loan_funding_splits_balance(p_loan_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status    loan_status;
  v_principal NUMERIC(15,2);
  v_split     NUMERIC(15,2);
BEGIN
  SELECT status, principal_amount INTO v_status, v_principal
  FROM public.loans WHERE id = p_loan_id;

  -- Loan gone (cascade delete) or not yet disbursed — nothing to assert.
  IF v_status IS NULL
     OR v_status NOT IN ('disbursed', 'active', 'completed', 'defaulted', 'written_off') THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_split
  FROM public.loan_funding_splits WHERE loan_id = p_loan_id;

  IF v_split <> v_principal THEN
    RAISE EXCEPTION
      'loan_funding_splits for loan % sum to % but the principal is % — every disbursed loan must be fully attributed to its funding sources',
      p_loan_id, v_split, v_principal
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.check_loan_funding_splits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.assert_loan_funding_splits_balance(
    COALESCE(NEW.loan_id, OLD.loan_id)
  );
  RETURN NULL;
END;
$$;

-- DEFERRED: the service inserts the loan's splits and flips its status within
-- one transaction, and the two orderings must both be legal.
CREATE CONSTRAINT TRIGGER trg_assert_loan_funding_splits
  AFTER INSERT OR UPDATE OR DELETE ON public.loan_funding_splits
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_loan_funding_splits();

-- The other direction: a loan cannot become disbursed without full attribution.
CREATE OR REPLACE FUNCTION private.check_loan_disbursed_attribution()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM private.assert_loan_funding_splits_balance(NEW.id);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_assert_loan_attribution_on_status
  AFTER INSERT OR UPDATE OF status, principal_amount ON public.loans
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION private.check_loan_disbursed_attribution();

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Every already-disbursed loan predates attribution, so it is by definition
-- funded from the group's own savings — the only source that existed. Without
-- this, the trigger above would make those loans unupdatable.
-- Production has 0 loans at the time of writing (verified), so this is for
-- other environments and for correctness if that changes before it is applied.
INSERT INTO public.loan_funding_splits (group_id, loan_id, funding_source_id, amount)
SELECT l.group_id, l.id, s.id, l.principal_amount
FROM public.loans l
JOIN public.group_funding_sources s
  ON s.group_id = l.group_id AND s.source_type = 'internal_savings'
WHERE l.status IN ('disbursed', 'active', 'completed', 'defaulted', 'written_off')
ON CONFLICT (loan_id, funding_source_id) DO NOTHING;

-- Fail the migration rather than leave a loan half-attributed.
DO $$
DECLARE
  bad INTEGER;
BEGIN
  SELECT count(*) INTO bad
  FROM public.loans l
  WHERE l.status IN ('disbursed', 'active', 'completed', 'defaulted', 'written_off')
    AND COALESCE((SELECT SUM(amount) FROM public.loan_funding_splits WHERE loan_id = l.id), 0)
        <> l.principal_amount;

  IF bad > 0 THEN
    RAISE EXCEPTION 'loan_funding_splits backfill incomplete: % disbursed loan(s) not fully attributed', bad;
  END IF;
END;
$$;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Group-scoped, plus read access for an organization whose allocation financed
-- the loan — that read is the whole point of the table, and it exposes only
-- amounts, never member identity (D5: organizations see member_code /
-- membership_no, never a name or contact field).

ALTER TABLE public.loan_funding_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_funding_splits FORCE  ROW LEVEL SECURITY;

CREATE POLICY loan_funding_splits_select ON public.loan_funding_splits
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR EXISTS (
      SELECT 1 FROM public.group_funding_sources s
      WHERE s.id = loan_funding_splits.funding_source_id
        AND s.organization_id IS NOT NULL
        AND s.organization_id = app_current_organization_id()
    )
  );

CREATE POLICY loan_funding_splits_insert ON public.loan_funding_splits
  FOR INSERT WITH CHECK (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY loan_funding_splits_update ON public.loan_funding_splits
  FOR UPDATE USING (is_super_admin() OR group_id = app_current_group_id());

CREATE POLICY loan_funding_splits_delete ON public.loan_funding_splits
  FOR DELETE USING (is_super_admin() OR group_id = app_current_group_id());
