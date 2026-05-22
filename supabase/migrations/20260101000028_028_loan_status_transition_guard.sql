-- Migration: 028 — Loan status transition guard
--
-- Adds a BEFORE UPDATE trigger that enforces the loan state machine at the
-- database level. Even if application code has a bug, illegal transitions are
-- blocked here.
--
-- Valid transitions:
--   pending    → approved | rejected
--   approved   → disbursed | rejected
--   disbursed  → active
--   active     → completed | defaulted
--   defaulted  → written_off
--   (all others are terminal — no further transitions)
--
-- This guard closes the gap identified in the audit where the service layer
-- validates transitions in code but has no database-level enforcement.

CREATE OR REPLACE FUNCTION public.validate_loan_status_transition()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  -- No-op when status hasn't changed
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  -- Validate the transition
  IF NOT (
       (OLD.status = 'pending'   AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved'  AND NEW.status IN ('disbursed', 'rejected'))
    OR (OLD.status = 'disbursed' AND NEW.status = 'active')
    OR (OLD.status = 'active'    AND NEW.status IN ('completed', 'defaulted'))
    OR (OLD.status = 'defaulted' AND NEW.status = 'written_off')
  ) THEN
    RAISE EXCEPTION
      'Invalid loan status transition: % → %. Loan id: %',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- Drop any previous version of this trigger before recreating
DROP TRIGGER IF EXISTS trg_validate_loan_status ON public.loans;

CREATE TRIGGER trg_validate_loan_status
  BEFORE UPDATE OF status ON public.loans
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_loan_status_transition();

COMMENT ON FUNCTION public.validate_loan_status_transition() IS
  'Enforces the loan lifecycle state machine at the DB level. '
  'Blocks any status transition not explicitly listed as valid.';
