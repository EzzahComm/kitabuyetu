-- =============================================================================
-- 027_journal_balance_insert_guard.sql
--
-- Closes a defence gap: postDisbursementJournal / postRepaymentJournal /
-- postContributionJournal in the application INSERT journal_entries directly
-- with status='posted', bypassing the BEFORE UPDATE trigger from migration 009.
--
-- Solution: DEFERRABLE INITIALLY DEFERRED constraint trigger on journal_lines.
-- PostgreSQL fires this at transaction COMMIT time (not immediately after each
-- INSERT), so by the time it runs all lines for the entry are already visible
-- and the debit/credit sum is complete.  It fires once per inserted line, but
-- each call sees the full set — so if the final state is balanced, every check
-- passes.
--
-- This is additive — it does not touch the existing BEFORE UPDATE trigger.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_posted_entry_balance()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_status  journal_status;
  v_debits  NUMERIC(15,2);
  v_credits NUMERIC(15,2);
BEGIN
  -- Fetch the parent entry status
  SELECT status INTO v_status
  FROM journal_entries
  WHERE id = NEW.journal_entry_id;

  -- Only enforce for posted entries
  IF v_status <> 'posted' THEN
    RETURN NEW;
  END IF;

  SELECT
    COALESCE(SUM(debit),  0),
    COALESCE(SUM(credit), 0)
  INTO v_debits, v_credits
  FROM journal_lines
  WHERE journal_entry_id = NEW.journal_entry_id;

  IF v_debits <> v_credits THEN
    RAISE EXCEPTION
      'Unbalanced journal entry %: debits=% credits=%',
      NEW.journal_entry_id, v_debits, v_credits;
  END IF;

  RETURN NEW;
END;
$$;

-- DEFERRABLE INITIALLY DEFERRED: fires at COMMIT, not immediately after INSERT.
-- At COMMIT all lines for the transaction are visible → correct balance sum.
CREATE CONSTRAINT TRIGGER trg_assert_posted_balance_deferred
  AFTER INSERT ON public.journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_posted_entry_balance();
