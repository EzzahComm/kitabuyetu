-- =============================================================================
-- 168: the column comment still says MONTHLY. Correct it.
--
-- Migration 167 changed how generate_loan_schedule reads loans.interest_rate
-- (nominal ANNUAL, not per month) and updated the form labels and the
-- function's own comments. It did not update the COMMENT ON COLUMN that 148
-- wrote — so the live database has spent since 2026-09-03 documenting the
-- opposite of what its own money engine does.
--
-- That comment is not decoration. It is what `\d+ loans` prints, what the
-- Supabase dashboard shows beside the column, what generated type docs carry,
-- and the one place a DBA looks to answer "what unit is this?". 167's header
-- claims "the unit lives here, in the form label, and in the schedule
-- generator's own comments" — the database's own answer was left contradicting
-- all three.
--
-- The unit has now flipped twice (148 monthly, 167 annual). The comment below
-- says so explicitly rather than just stating the current value, because the
-- failure mode both times was someone reading a stale assertion and believing
-- it.
--
-- No data, schema or behaviour changes here. Comment only — safe to re-run.
-- =============================================================================

COMMENT ON COLUMN public.loans.interest_rate IS
  'NOMINAL ANNUAL interest rate as a percentage (10.00 = 10% per year). '
  'Flat interest is principal * (rate/100) * (loan_term_months/12), so a term '
  'shorter than a year is prorated. '
  'HISTORY, because this unit has changed twice and stale comments caused both '
  'incidents: migration 054 read it as annual while every screen said "%/mo"; '
  'migration 148 made it MONTHLY to match those labels; migration 167 reverted '
  'to ANNUAL after confirming that every rate anyone had actually entered was '
  'an annual one, and reissued the four live schedules that had been priced '
  'twelve times over. Do not change this reading again without also changing '
  'the form labels, the loan detail screen, the loan_approved email template, '
  'the group loan-terms policy editor, and this comment.';
