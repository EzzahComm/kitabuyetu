-- ─────────────────────────────────────────────────────────────────────────────
-- 167 — loans.interest_rate is a NOMINAL ANNUAL rate, not a monthly one
--
-- WHAT WAS WRONG
--
-- generate_loan_schedule treated interest_rate as a rate PER MONTH. It said so
-- in its own comments and the loan application form was labelled
-- "Interest rate (%/month)", so the engine was internally consistent — but the
-- business quotes lending annually, and every rate entered has been an annual
-- one. A product sold at "5% per annum" was therefore scheduled at 5% per
-- month: twelve times the intended price.
--
-- Measured on the four live loans, all disbursed 2026-08-16, all
-- reducing-balance over 12 months at interest_rate = 5.00:
--
--   principal   scheduled     correct at 5% p.a.   overcharge
--     400,000     541,562              410,935       130,627
--     270,000     365,554              277,381        88,173
--     270,000     365,554              277,381        88,173
--     130,000     176,008              133,554        42,454
--                                                    ───────
--                                                    349,427
--
-- WHY THE CONVENTION CHANGES INSTEAD OF THE DATA
--
-- Repricing those four rows would leave the next loan wrong. "5% per annum" is
-- how lending is quoted everywhere, so the field should mean what everyone
-- reading it already assumes. Changing the engine fixes the four loans and
-- every loan after them at once.
--
-- SAFE TO DO NOW, AND ONLY NOW
--
-- amount_paid is 0 on every instalment of all four loans — nobody has been
-- overcharged in cash, only shown a wrong schedule. There are four loans in
-- the entire production database and exactly one loan-terms policy (platform
-- level, interestRate 10, flat), with no organization or group override. This
-- is the cheapest this change will ever be.
--
-- Under the old reading that platform default meant 10% per month — 120% of
-- principal over a 12-month flat loan. Read annually it means 10%, which is
-- self-evidently what was intended, so the stored policy needs no edit.
--
-- NOT CHANGED HERE
--
-- The stored interest_rate VALUES stay as they are. 5.00 already means "5%",
-- and after this migration the engine reads it the way it was always meant.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_loan_schedule(p_loan_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_loan            loans%ROWTYPE;
  v_periods_per_yr  INTEGER;
  v_interval        INTERVAL;
  v_n               INTEGER;
  v_periodic_rate   NUMERIC(20,10);
  v_emi             NUMERIC(15,2);
  v_balance         NUMERIC(15,2);
  v_interest        NUMERIC(15,2);
  v_principal       NUMERIC(15,2);
  v_due_date        DATE;
  v_total_interest  NUMERIC(15,2);
  v_interest_per    NUMERIC(15,2);
  v_principal_per   NUMERIC(15,2);
  i                 INTEGER;
BEGIN
  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  -- Cadence -> periods per year and the step between due dates.
  CASE COALESCE(v_loan.repayment_frequency, 'monthly')
    WHEN 'weekly'    THEN v_periods_per_yr := 52; v_interval := INTERVAL '1 week';
    WHEN 'biweekly'  THEN v_periods_per_yr := 26; v_interval := INTERVAL '2 weeks';
    WHEN 'monthly'   THEN v_periods_per_yr := 12; v_interval := INTERVAL '1 month';
    WHEN 'quarterly' THEN v_periods_per_yr := 4;  v_interval := INTERVAL '3 months';
    ELSE RAISE EXCEPTION 'Unsupported repayment_frequency: %', v_loan.repayment_frequency;
  END CASE;

  -- Instalment count. Floored at 1 so a short term at a slow cadence (e.g. a
  -- 1-month quarterly loan) still yields one payable instalment rather than an
  -- empty schedule and a loan with no next_payment_date.
  v_n := GREATEST(1, ROUND(v_loan.loan_term_months * v_periods_per_yr / 12.0)::INTEGER);

  DELETE FROM loan_repayments WHERE loan_id = p_loan_id;

  v_balance  := v_loan.principal_amount;
  v_due_date := COALESCE(v_loan.disbursement_date, CURRENT_DATE);

  IF v_loan.interest_method = 'flat' THEN
    -- interest_rate is ANNUAL, so the term is converted to years. Still
    -- cadence-independent by construction: the total depends on the term, not
    -- on how many instalments it is divided into.
    --
    -- Previously this multiplied by loan_term_months directly, which charged a
    -- full year of interest for every month of the term.
    v_total_interest := ROUND(v_loan.principal_amount * (v_loan.interest_rate / 100.0)
                              * (v_loan.loan_term_months / 12.0), 2);
    v_interest_per   := ROUND(v_total_interest / v_n, 2);
    v_principal_per  := ROUND(v_loan.principal_amount / v_n, 2);

    FOR i IN 1..v_n LOOP
      v_due_date := v_due_date + v_interval;
      -- Final instalment absorbs the rounding drift of the preceding ones, so
      -- the schedule sums to exactly principal + total interest.
      IF i = v_n THEN
        v_principal := v_balance;
        v_interest  := ROUND(v_total_interest - v_interest_per * (v_n - 1), 2);
      ELSE
        v_principal := LEAST(v_principal_per, v_balance);
        v_interest  := v_interest_per;
      END IF;

      INSERT INTO loan_repayments (
        group_id, loan_id, member_id, group_membership_id,
        installment_number, due_date,
        opening_balance, principal_component, interest_component,
        total_due, closing_balance
      ) VALUES (
        v_loan.group_id, v_loan.id, v_loan.member_id, v_loan.group_membership_id,
        i, v_due_date,
        v_balance, v_principal, v_interest,
        v_principal + v_interest, v_balance - v_principal
      );

      v_balance := v_balance - v_principal;
    END LOOP;

  ELSE
    -- Nominal ANNUAL rate divided across the payment periods in a year. At
    -- monthly cadence 5% p.a. gives 0.4167% per period.
    --
    -- Previously this was (rate/100) * 12 / periods_per_yr, which at monthly
    -- cadence resolved to rate/100 — i.e. it spent the whole annual rate every
    -- single month.
    v_periodic_rate := (v_loan.interest_rate / 100.0) / v_periods_per_yr;

    IF v_periodic_rate = 0 THEN
      v_emi := ROUND(v_balance / v_n, 2);
    ELSE
      v_emi := ROUND(
        v_balance * v_periodic_rate
          * POWER(1 + v_periodic_rate, v_n)
          / (POWER(1 + v_periodic_rate, v_n) - 1),
        2
      );
    END IF;

    FOR i IN 1..v_n LOOP
      v_due_date  := v_due_date + v_interval;
      v_interest  := ROUND(v_balance * v_periodic_rate, 2);
      v_principal := LEAST(v_emi - v_interest, v_balance);

      INSERT INTO loan_repayments (
        group_id, loan_id, member_id, group_membership_id,
        installment_number, due_date,
        opening_balance, principal_component, interest_component,
        total_due, closing_balance
      ) VALUES (
        v_loan.group_id, v_loan.id, v_loan.member_id, v_loan.group_membership_id,
        i, v_due_date,
        v_balance, v_principal, v_interest,
        v_principal + v_interest, v_balance - v_principal
      );

      v_balance := v_balance - v_principal;
      EXIT WHEN v_balance <= 0;
    END LOOP;
  END IF;

  UPDATE loans SET
    total_repayable     = (SELECT SUM(total_due) FROM loan_repayments WHERE loan_id = p_loan_id),
    outstanding_balance = v_loan.principal_amount,
    next_payment_date   = (SELECT MIN(due_date) FROM loan_repayments WHERE loan_id = p_loan_id AND status = 'pending')
  WHERE id = p_loan_id;
END;
$function$;

-- Privileges, restated rather than assumed. CREATE OR REPLACE has twice left
-- this codebase with function grants it did not intend, so they are set
-- explicitly here instead of trusted to carry over.
--
-- PUBLIC (and therefore anon) held EXECUTE before this migration. It is
-- dropped: this function DELETEs and rewrites a loan's entire repayment
-- schedule, and nothing anonymous has any business calling it. Every role that
-- actually reaches it keeps it — app_tenant runs the UPDATE that fires
-- trg_loan_on_disburse, authenticated covers API callers, service_role covers
-- admin paths. The function is not SECURITY DEFINER, so RLS still applies to
-- each of them.
REVOKE ALL ON FUNCTION public.generate_loan_schedule(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_loan_schedule(UUID) TO authenticated, service_role;

-- app_tenant is provisioned out-of-band in production, not by any migration
-- (see 133), so it does not exist on a freshly-provisioned database (CI,
-- Supabase preview branches). Guarded the same way every grant to it has
-- been since 133.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT EXECUTE ON FUNCTION public.generate_loan_schedule(UUID) TO app_tenant;
  END IF;
END
$grant$;

-- ── Reissue the schedules that were written under the old reading ────────────
--
-- Restricted to loans with NOTHING paid. A loan with a payment against it has
-- money reconciled to specific instalments, and silently rewriting those rows
-- would orphan it. All four live loans qualify today; the guard is here so
-- this stays correct if it is ever re-run.
DO $regen$
DECLARE
  r        RECORD;
  v_count  INTEGER := 0;
BEGIN
  FOR r IN
    SELECT l.id
      FROM loans l
     WHERE l.status IN ('active', 'disbursed')
       AND NOT EXISTS (
         SELECT 1 FROM loan_repayments lr
          WHERE lr.loan_id = l.id AND COALESCE(lr.amount_paid, 0) > 0
       )
  LOOP
    PERFORM public.generate_loan_schedule(r.id);
    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Reissued % loan schedule(s) at the annual rate', v_count;
END
$regen$;

-- ── Prove it actually took ───────────────────────────────────────────────────
--
-- Asserts on a real computed value rather than just running. A DO block that
-- can pass by doing nothing proves nothing, which has bitten this project
-- before.
--
-- Simple interest (rate x term-in-years) is a hard upper bound for a
-- reducing-balance schedule, since the balance only ever declines. 20% slack
-- absorbs rounding on tiny loans. Under the OLD monthly reading a 12-month
-- loan sat ~12x above this line, so any survivor fails loudly.
DO $verify$
DECLARE
  v_bad     INTEGER;
  v_checked INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_checked
    FROM loans WHERE status IN ('active', 'disbursed') AND total_repayable IS NOT NULL;

  SELECT COUNT(*) INTO v_bad
    FROM loans l
   WHERE l.status IN ('active', 'disbursed')
     AND l.total_repayable IS NOT NULL
     AND l.total_repayable >
         l.principal_amount * (1 + (l.interest_rate / 100.0) * (l.loan_term_months / 12.0) * 1.2);

  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'Migration 167 verification FAILED: % of % live loan(s) still priced above the annual-rate ceiling',
      v_bad, v_checked;
  END IF;

  RAISE NOTICE 'Migration 167 verified: % live loan(s), all within the annual-rate ceiling', v_checked;
END
$verify$;
