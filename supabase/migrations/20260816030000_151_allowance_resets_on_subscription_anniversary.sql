-- =============================================================================
-- 151: the SMS allowance resets on each group's own billing anniversary
--
-- resetMonthlySmsAllowance() zeroed sms_allowance_used for EVERY active group
-- on the 1st of the month at 01:00 UTC. But a subscription's cycle runs from
-- the day it was bought — THE FIONA'S started on the 11th, Kaka on the 14th,
-- Joka on the 12th. Their billing cycles and their allowance periods therefore
-- disagreed with each other:
--
--   * a group subscribing on the 28th got a fresh allowance three days later,
--     effectively two allowances in its first cycle;
--   * a group subscribing on the 2nd waited 29 days for its reset while its
--     next invoice fell due on the 2nd.
--
-- The allowance is part of what the plan buys, so its period has to be the
-- plan's period.
--
-- WHY A NEW COLUMN RATHER THAN next_billing_date. `subscriptions.next_billing_
-- date` looks like the natural anchor and is not usable: it is written once by
-- the two INSERTs in billing.service.ts and NOTHING ever advances it. Every
-- active row still holds started_at + 1 month, and all expired rows hold NULL.
-- Keying a recurring reset off a date that never moves would reset once and
-- then never again. `sms_allowance_period_start` records what the job actually
-- did, which is the only fact that can be trusted here.
--
-- The anniversary is derived from started_at on every run rather than by
-- repeatedly adding a month, so it CANNOT DRIFT. Postgres clamps 31 January +
-- 1 month to 28 February, but the following anniversary is computed from
-- started_at again and lands on 31 March. (Contrast generate_loan_schedule,
-- which accumulates from the previous due date and therefore sticks on the
-- 28th for the rest of the loan — see HARDENING_AUDIT_2026-08-16.md.)
-- =============================================================================

ALTER TABLE public.billing_accounts
  ADD COLUMN IF NOT EXISTS sms_allowance_period_start DATE;

COMMENT ON COLUMN public.billing_accounts.sms_allowance_period_start IS
  'First day of the allowance period currently in force — the subscription '
  'anniversary the last reset was performed for (migration 151). NULL means '
  'the account has never been reset under the anniversary scheme. Compared '
  'against the anniversary derived from subscriptions.started_at, which makes '
  'the daily reset job idempotent: it fires once per group per cycle no '
  'matter how often it runs.';

-- Seed the current period so the first daily run does not treat every account
-- as overdue and hand out a bonus allowance. Existing accounts keep whatever
-- they have already consumed this cycle.
UPDATE public.billing_accounts ba
SET    sms_allowance_period_start = (
         s.started_at::date
         + ((date_part('year',  age(CURRENT_DATE, s.started_at::date)) * 12
           + date_part('month', age(CURRENT_DATE, s.started_at::date)))::int)
           * INTERVAL '1 month'
       )::date
FROM   public.subscriptions s
WHERE  s.group_id = ba.group_id
  AND  s.status   = 'active'
  AND  ba.sms_allowance_period_start IS NULL;

-- The daily job scans active subscriptions and compares the derived
-- anniversary against this column, so both sides of that join want indexing.
CREATE INDEX IF NOT EXISTS idx_billing_accounts_allowance_period
  ON public.billing_accounts (sms_allowance_period_start);
