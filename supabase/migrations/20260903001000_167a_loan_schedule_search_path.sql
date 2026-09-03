-- ─────────────────────────────────────────────────────────────────────────────
-- 167a — restore the search_path pin that 167's CREATE OR REPLACE dropped
--
-- CREATE OR REPLACE FUNCTION replaces the ENTIRE definition, SET clauses
-- included. Migration 167 restated the function's grants explicitly (having
-- been bitten by exactly that before) but not its SET clause, so
-- generate_loan_schedule came back with a mutable search_path while its own
-- caller trg_loan_on_disburse stays pinned to `private, public` and
-- register_group to `public`.
--
-- Nothing failed. It surfaced only because get_advisors was run after the DDL
-- (function_search_path_mutable), which is the whole reason that check exists
-- in this project's routine.
--
-- Kept as a separate migration rather than folded into 167 so the file history
-- matches what production actually had applied to it, in that order.
--
-- Pinned to match the caller. The function is not SECURITY DEFINER, so this is
-- defence in depth rather than a privilege boundary — but an unpinned
-- search_path on a function that rewrites repayment schedules is not worth
-- leaving to chance.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER FUNCTION public.generate_loan_schedule(UUID) SET search_path = private, public;

DO $verify$
DECLARE
  v_config TEXT;
BEGIN
  SELECT COALESCE(array_to_string(p.proconfig, ', '), '(none)')
    INTO v_config
    FROM pg_proc p
   WHERE p.proname = 'generate_loan_schedule'
     AND p.pronamespace = 'public'::regnamespace;

  IF v_config IS NULL OR v_config = '(none)' THEN
    RAISE EXCEPTION 'Migration 167a FAILED: generate_loan_schedule still has a mutable search_path';
  END IF;

  RAISE NOTICE 'Migration 167a verified: generate_loan_schedule pinned to %', v_config;
END
$verify$;
