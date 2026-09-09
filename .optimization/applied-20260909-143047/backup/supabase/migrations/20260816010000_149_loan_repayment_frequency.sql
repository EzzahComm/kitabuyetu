-- =============================================================================
-- 149: member loans can repay weekly / bi-weekly / monthly / quarterly
--
-- Until now every member loan repaid MONTHLY and nothing could change that:
-- `loans` carried only `loan_term_months`, and generate_loan_schedule looped
-- `1..loan_term_months` adding INTERVAL '1 month'. Chamas that meet and collect
-- weekly had to be modelled as monthly borrowers.
--
-- Note the asymmetry this closes: `organization_disbursements` has HAD a
-- `repayment_frequency` column all along — the live EZZAHCOMM -> THE FIONA'S
-- allocation is set to 'weekly' — so the capital side already modelled cadence
-- while the member side could not.
--
-- REMINDERS NEED NO CHANGE. handleLoanDueAlerts (lib/jobs/handlers.ts) selects
-- straight from loan_repayments.due_date and stages purely on day offsets
-- (3 days before / due today / overdue 3, 7, 14). It never reads a term or a
-- cadence, so weekly schedule rows produce weekly reminders automatically.
--
-- ---------------------------------------------------------------------------
-- Two invariants this migration is built around
-- ---------------------------------------------------------------------------
--
-- 1. EXISTING LOANS MUST NOT MOVE. The column defaults to 'monthly' and the
--    monthly arm computes exactly what it computed before (periods_per_year
--    12 => periodic rate = interest_rate/100, interval = 1 month, n = term).
--    Regenerating any pre-existing loan reproduces its current schedule
--    byte-for-byte. This is the whole reason frequency is derived into
--    `v_periods_per_year` rather than branching on strings inside the loop.
--
-- 2. CADENCE MUST NOT CHANGE THE PRICE. Borrowing the same money for the same
--    term costs the same whether you repay it weekly or monthly; only the
--    instalment size and count change. Concretely:
--      * flat     - total interest is principal * (rate/100) * term_months.
--                   interest_rate is MONTHLY (migration 148) and the term is in
--                   months, so this expression never mentions frequency at all.
--      * reducing - the periodic rate is the nominal conversion
--                   (rate/100) * 12 / periods_per_year, so a 10%/month loan is
--                   10 * 12/52 % per week. Not an exact APR-equivalent
--                   conversion (weekly compounding of a nominal rate yields
--                   slightly more than monthly), which is the standard,
--                   explainable market convention and the one a treasurer can
--                   reproduce on paper.
--
-- Instalment count is ROUND(term_months * periods_per_year / 12), floored at 1.
-- For a 12-month term: weekly 52, bi-weekly 26, monthly 12, quarterly 4.
--
-- Vocabulary note: 'weekly'/'monthly'/'quarterly' match the existing
-- REPAYMENT_FREQUENCIES list already used by the organization side
-- (lib/validators/organization.schema.ts); 'biweekly' matches the existing
-- meeting_frequency enum's spelling. Deliberately NOT a new parallel
-- vocabulary — that is how two enums for one concept drift apart.
-- 'none' and 'bullet' from the org list are excluded: neither produces an
-- amortisation schedule, and a loan must always have one.
-- =============================================================================

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS repayment_frequency TEXT NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.loans'::regclass AND conname = 'loans_repayment_frequency_check'
  ) THEN
    ALTER TABLE public.loans
      ADD CONSTRAINT loans_repayment_frequency_check
      CHECK (repayment_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly'));
  END IF;
END $$;

COMMENT ON COLUMN public.loans.repayment_frequency IS
  'How often an instalment falls due. Defaults to monthly, which reproduces '
  'the pre-migration-149 behaviour exactly. Does NOT change the cost of the '
  'loan — see migration 149 for why total interest is cadence-independent.';

-- Body is pg_get_functiondef of the LIVE function (as replaced by migration
-- 148), with frequency threaded through. Never rebuild this from an older
-- migration file: doing exactly that in the first cut of 148 silently reverted
-- both group_membership_id and the trailing UPDATE.
CREATE OR REPLACE FUNCTION public.generate_loan_schedule(p_loan_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
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
    -- Cadence-independent by construction: interest_rate is per MONTH and the
    -- term is in months, so the total is identical at every frequency. Only
    -- the division into v_n instalments below differs.
    v_total_interest := ROUND(v_loan.principal_amount * (v_loan.interest_rate / 100.0)
                              * v_loan.loan_term_months, 2);
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
    -- Nominal conversion of the monthly rate to the payment period. At
    -- periods_per_year = 12 this is exactly interest_rate/100, i.e. unchanged
    -- from migration 148 for every existing (monthly) loan.
    v_periodic_rate := (v_loan.interest_rate / 100.0) * 12.0 / v_periods_per_yr;

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

-- The due-date scan behind notify_loan_due_alerts now returns up to 52 rows per
-- loan-year instead of 12. It filters on due_date and status, so keep those
-- leading; without this a weekly-heavy group turns the daily 06:00 reminder
-- sweep into a growing sequential scan of loan_repayments.
CREATE INDEX IF NOT EXISTS idx_loan_repayments_due_pending
  ON public.loan_repayments (due_date)
  WHERE status = 'pending';
