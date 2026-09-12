-- =============================================================================
-- 169: re-pin generate_loan_schedule to `public`, not `private, public`
--
-- 167a set:  SET search_path = private, public
-- 016/148/149 had all set:  search_path = public
--
-- 167a described itself as "restoring the pin that 167's CREATE OR REPLACE
-- dropped". It did not restore it — it changed it, putting a second schema
-- AHEAD of public.
--
-- Why that matters here specifically. generate_loan_schedule refers to `loans`
-- and `loan_repayments` unqualified, and it does not merely read them: it
-- DELETEs a loan's entire repayment schedule and writes a new one. With
-- `private` resolved first, creating a table called private.loans or
-- private.loan_repayments at any point in the future silently redirects the
-- money engine onto it. No error, no warning — the schedule is rewritten
-- against the wrong table.
--
-- Today `private` exists but holds ZERO objects, so nothing is shadowed and
-- nothing is currently broken. That is exactly why this is worth fixing now
-- and not after: an empty schema is a cheap fix and a loaded gun.
--
-- 167a's stated reason was to match its caller trg_loan_on_disburse, which is
-- pinned to `private, public`. A caller's search_path is not this function's
-- contract — search_path is per-function and does not inherit — and this
-- function needs nothing from `private`. `public` is both correct and what
-- three prior migrations chose.
--
-- Not SECURITY DEFINER, so this is defence in depth rather than a privilege
-- boundary. Comment/config only: no data, no schema, no behaviour change.
-- Safe to re-run.
-- =============================================================================

ALTER FUNCTION public.generate_loan_schedule(UUID) SET search_path = public;

DO $verify$
DECLARE
  v_config TEXT;
BEGIN
  SELECT COALESCE(array_to_string(p.proconfig, ', '), '(none)')
    INTO v_config
    FROM pg_proc p
   WHERE p.proname = 'generate_loan_schedule'
     AND p.pronamespace = 'public'::regnamespace;

  -- Assert the VALUE, not merely that a pin exists. 167a's verify only checked
  -- that proconfig was non-empty, which is why it passed while setting a value
  -- nobody intended. A check that cannot fail is not a check.
  IF v_config IS DISTINCT FROM 'search_path=public' THEN
    RAISE EXCEPTION
      'Migration 169 FAILED: expected search_path=public, found "%"', v_config;
  END IF;

  RAISE NOTICE 'Migration 169 verified: generate_loan_schedule pinned to %', v_config;
END
$verify$;

-- ─── Diagnostic only: the two gaps 167 left, neither of which has any affected
--     row today. Reported, deliberately NOT auto-corrected — rewriting the
--     schedule of a defaulted or written-off loan is a decision about a debt
--     someone is being chased for, not a migration's call to make.
DO $diagnose$
DECLARE
  v_skipped_status INTEGER;
  v_paid           INTEGER;
BEGIN
  -- Gap 1: 167's regeneration ran only for status IN ('active','disbursed').
  -- completed / defaulted / written_off loans kept schedules priced at the old
  -- monthly reading. 167's verify block used the SAME status filter, so it
  -- reported "all within the annual-rate ceiling" without ever looking at them.
  SELECT count(*) INTO v_skipped_status
    FROM loans
   WHERE status NOT IN ('active', 'disbursed');

  -- Gap 2: 167's regen skipped loans with any amount_paid > 0 (correctly — the
  -- money is reconciled to specific instalments). Its verify did not, so a
  -- REPLAY of 167 against a database holding a partially-paid loan raises and
  -- rolls the whole migration back. Zero such rows today; the first Fionas
  -- instalment falls due 16 Sep 2026, after which a replay would abort.
  SELECT count(*) INTO v_paid
    FROM loan_repayments
   WHERE amount_paid > 0;

  IF v_skipped_status > 0 THEN
    RAISE NOTICE
      '169 diagnostic: % loan(s) outside active/disbursed were skipped by 167 and may still '
      'carry a schedule priced at 12x. Review them by hand.', v_skipped_status;
  END IF;

  IF v_paid > 0 THEN
    RAISE NOTICE
      '169 diagnostic: % repayment row(s) have amount_paid > 0. Migration 167 is no longer '
      'safely replayable against this database — its verify block does not share its regen '
      'guard. Do not replay 167 here.', v_paid;
  END IF;

  IF v_skipped_status = 0 AND v_paid = 0 THEN
    RAISE NOTICE '169 diagnostic: clean — no skipped-status loans, no paid instalments.';
  END IF;
END
$diagnose$;
