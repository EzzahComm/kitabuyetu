-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260602122107  name: 054_loan_interest_method
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

ALTER TABLE loans
  ADD COLUMN interest_method VARCHAR(20) NOT NULL DEFAULT 'reducing_balance'
    CHECK (interest_method IN ('flat', 'reducing_balance'));

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
    v_total_interest := ROUND(v_loan.principal_amount * (v_loan.interest_rate / 100.0)
                              * (v_loan.loan_term_months / 12.0), 2);
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
    v_monthly_rate := v_loan.interest_rate / 12.0 / 100.0;

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

  UPDATE loans SET
    total_repayable     = (SELECT SUM(total_due) FROM loan_repayments WHERE loan_id = p_loan_id),
    outstanding_balance = v_loan.principal_amount,
    next_payment_date   = (SELECT MIN(due_date) FROM loan_repayments WHERE loan_id = p_loan_id AND status = 'pending')
  WHERE id = p_loan_id;
END;
$function$;
