-- =============================================================================
-- 148: loans.interest_rate is a MONTHLY rate
--
-- The UI has always labelled this field "% /mo" (loan form, loan detail:
-- "10.00% /mo × 12 months"). generate_loan_schedule treated it as ANNUAL, in
-- both interest methods:
--
--   flat:             principal * (rate/100) * (term_months / 12.0)
--   reducing_balance: monthly_rate = rate / 12.0 / 100.0
--
-- Both divide by 12, so the two methods agreed with each other and disagreed
-- with every screen a group sees. Confirmed on live data: a real 130,000 loan
-- at 10.00 over 12 months produced total_repayable 137,148.78 — about 5.5% of
-- principal, which is 10% ANNUAL on a declining balance. Read as the screen
-- states it (10% per month) the same loan carries roughly 98,930 of interest.
-- A ~13x understatement.
--
-- Decision (2026-08-16): the LABEL is right and the engine is wrong. A group
-- entering 10 means 10% per month, which is the norm for chama lending in this
-- market. Both methods therefore drop the /12.
--
-- THIS CHANGES MONEY. It does not touch existing rows: generate_loan_schedule
-- only runs on disbursement, so already-disbursed loans keep the schedules
-- they were given until someone deliberately regenerates them. The four loans
-- disbursed 2026-08-16 under the old reading are handled separately, with
-- sign-off, precisely so this migration stays a pure behaviour change and the
-- correction of live balances is a visible, separate act.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.generate_loan_schedule(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_loan            loans%ROWTYPE;
  v_monthly_rate    NUMERIC(20,10);
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

  DELETE FROM loan_repayments WHERE loan_id = p_loan_id;

  v_balance  := v_loan.principal_amount;
  v_due_date := COALESCE(v_loan.disbursement_date, CURRENT_DATE);

  IF v_loan.interest_method = 'flat' THEN
    -- Was `* (loan_term_months / 12.0)`. The rate is per month, so the
    -- multiplier is simply the number of months.
    v_total_interest := ROUND(v_loan.principal_amount * (v_loan.interest_rate / 100.0)
                              * v_loan.loan_term_months, 2);
    v_interest_per   := ROUND(v_total_interest / v_loan.loan_term_months, 2);
    v_principal_per  := ROUND(v_loan.principal_amount / v_loan.loan_term_months, 2);

    FOR i IN 1..v_loan.loan_term_months LOOP
      v_due_date := v_due_date + INTERVAL '1 month';
      IF i = v_loan.loan_term_months THEN
        v_principal := v_balance;
        v_interest  := ROUND(v_total_interest - v_interest_per * (v_loan.loan_term_months - 1), 2);
      ELSE
        v_principal := LEAST(v_principal_per, v_balance);
        v_interest  := v_interest_per;
      END IF;

      INSERT INTO loan_repayments (
        group_id, loan_id, member_id,
        installment_number, due_date,
        opening_balance, principal_component, interest_component,
        total_due, closing_balance
      ) VALUES (
        v_loan.group_id, v_loan.id, v_loan.member_id,
        i, v_due_date,
        v_balance, v_principal, v_interest,
        v_principal + v_interest, v_balance - v_principal
      );

      v_balance := v_balance - v_principal;
    END LOOP;

  ELSE
    -- Was `/ 12.0 / 100.0`. The stored rate IS the monthly rate.
    v_monthly_rate := v_loan.interest_rate / 100.0;

    IF v_monthly_rate = 0 THEN
      v_emi := ROUND(v_balance / v_loan.loan_term_months, 2);
    ELSE
      v_emi := ROUND(
        v_balance * v_monthly_rate
          * POWER(1 + v_monthly_rate, v_loan.loan_term_months)
          / (POWER(1 + v_monthly_rate, v_loan.loan_term_months) - 1),
        2
      );
    END IF;

    FOR i IN 1..v_loan.loan_term_months LOOP
      v_due_date  := v_due_date + INTERVAL '1 month';
      v_interest  := ROUND(v_balance * v_monthly_rate, 2);
      v_principal := LEAST(v_emi - v_interest, v_balance);

      INSERT INTO loan_repayments (
        group_id, loan_id, member_id,
        installment_number, due_date,
        opening_balance, principal_component, interest_component,
        total_due, closing_balance
      ) VALUES (
        v_loan.group_id, v_loan.id, v_loan.member_id,
        i, v_due_date,
        v_balance, v_principal, v_interest,
        v_principal + v_interest, v_balance - v_principal
      );

      v_balance := v_balance - v_principal;
      EXIT WHEN v_balance <= 0;
    END LOOP;
  END IF;
END;
$function$;

COMMENT ON COLUMN public.loans.interest_rate IS
  'MONTHLY interest rate as a percentage (10.00 = 10% per month), matching '
  'the "% /mo" label the loan form and loan detail have always shown. '
  'Migration 148: generate_loan_schedule previously divided this by 12 in '
  'both interest methods, so every schedule was built at one twelfth of the '
  'stated rate.';
