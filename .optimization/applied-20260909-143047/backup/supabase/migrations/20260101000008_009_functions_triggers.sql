-- =============================================================================
-- 009_functions_triggers.sql
-- DB-level helper functions, session context accessors, and triggers
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Session context accessors
-- These are called from RLS policies. Using current_setting() with the
-- missing_ok=true flag prevents errors when the variable is not set (e.g.
-- during migrations run outside of a request context).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_current_group_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NULLIF(current_setting('app.current_group_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_current_role()
RETURNS TEXT LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NULLIF(current_setting('app.current_role', true), '');
$$;

CREATE OR REPLACE FUNCTION app_current_ngo_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT NULLIF(current_setting('app.current_ngo_id', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- updated_at auto-stamp trigger
-- Attached to every table that has an updated_at column.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Attach to all tables with updated_at
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'groups', 'members', 'group_members', 'refresh_tokens',
    'contributions', 'loans', 'loan_repayments',
    'accounts', 'journal_entries', 'journal_lines',
    'billing_accounts', 'subscriptions', 'invoices', 'invoice_items', 'payments',
    'sms_usage_logs', 'sms_credits',
    'ngos', 'ngo_group_access',
    'notifications'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Audit trigger factory
-- Logs INSERT/UPDATE/DELETE on sensitive tables.
-- Called with the resource_type as trigger argument.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_sensitive_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_resource_type TEXT  := TG_ARGV[0];
  v_resource_id   UUID;
  v_old_values    JSONB;
  v_new_values    JSONB;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_resource_id := OLD.id;
    v_old_values  := to_jsonb(OLD);
    v_new_values  := NULL;
  ELSIF TG_OP = 'INSERT' THEN
    v_resource_id := NEW.id;
    v_old_values  := NULL;
    v_new_values  := to_jsonb(NEW);
  ELSE
    v_resource_id := NEW.id;
    v_old_values  := to_jsonb(OLD);
    v_new_values  := to_jsonb(NEW);
  END IF;

  INSERT INTO audit_logs (
    group_id,
    actor_id,
    action,
    resource_type,
    resource_id,
    old_values,
    new_values
  ) VALUES (
    app_current_group_id(),
    app_current_user_id(),
    TG_OP || '.' || v_resource_type,
    v_resource_type,
    v_resource_id,
    v_old_values,
    v_new_values
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- Attach audit trigger to sensitive tables
CREATE TRIGGER trg_members_audit
  AFTER INSERT OR UPDATE OR DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_change('member');

CREATE TRIGGER trg_loans_audit
  AFTER INSERT OR UPDATE OR DELETE ON loans
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_change('loan');

CREATE TRIGGER trg_contributions_audit
  AFTER INSERT OR UPDATE OR DELETE ON contributions
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_change('contribution');

CREATE TRIGGER trg_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_change('payment');

CREATE TRIGGER trg_subscriptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION audit_sensitive_change('subscription');

-- ---------------------------------------------------------------------------
-- journal_entry balance validation
-- Prevents posting a journal entry where debits ≠ credits.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_journal_balance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sum_debits  NUMERIC(15,2);
  v_sum_credits NUMERIC(15,2);
BEGIN
  -- Only enforce on transition to 'posted'
  IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
    SELECT
      COALESCE(SUM(debit),  0),
      COALESCE(SUM(credit), 0)
    INTO v_sum_debits, v_sum_credits
    FROM journal_lines
    WHERE journal_entry_id = NEW.id;

    IF v_sum_debits <> v_sum_credits THEN
      RAISE EXCEPTION
        'Journal entry % is unbalanced: debits=% credits=%',
        NEW.id, v_sum_debits, v_sum_credits;
    END IF;

    IF v_sum_debits = 0 THEN
      RAISE EXCEPTION
        'Journal entry % has no lines', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_entries_validate_balance
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION validate_journal_balance();

-- ---------------------------------------------------------------------------
-- account balance update trigger
-- When a journal line is inserted/updated/deleted on a posted entry,
-- update the denormalized balance on the affected account.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_entry_status journal_status;
BEGIN
  -- Determine the status of the parent entry
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_entry_status
    FROM journal_entries WHERE id = OLD.journal_entry_id;
  ELSE
    SELECT status INTO v_entry_status
    FROM journal_entries WHERE id = NEW.journal_entry_id;
  END IF;

  -- Only adjust balances for posted entries
  IF v_entry_status <> 'posted' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    UPDATE accounts
    SET balance = balance + NEW.debit - NEW.credit
    WHERE id = NEW.account_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE accounts
    SET balance = balance - OLD.debit + OLD.credit
    WHERE id = OLD.account_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE accounts
    SET balance = balance - OLD.debit + OLD.credit + NEW.debit - NEW.credit
    WHERE id = NEW.account_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_journal_lines_update_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION update_account_balance();

-- ---------------------------------------------------------------------------
-- SMS credit deduction function
-- Called atomically from the SMS service. Returns false if insufficient credits.
-- Using advisory lock on group_id to prevent race conditions.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deduct_sms_credits(
  p_group_id    UUID,
  p_credits     NUMERIC(8,4)
) RETURNS BOOLEAN LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_current NUMERIC(15,2);
BEGIN
  -- Row-level lock on the billing account for this group
  SELECT sms_credits INTO v_current
  FROM billing_accounts
  WHERE group_id = p_group_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'No billing account for group %', p_group_id;
  END IF;

  IF v_current < p_credits THEN
    RETURN false;
  END IF;

  UPDATE billing_accounts
  SET sms_credits = sms_credits - p_credits
  WHERE group_id = p_group_id;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Invoice number generator
-- Format: KY-YYYYMM-NNNN (e.g. KY-202501-0042)
-- Uses a per-month sequence stored in a small helper table to avoid gaps.
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_sequences (
  year_month  CHAR(6)  PRIMARY KEY,  -- 'YYYYMM'
  last_seq    INTEGER  NOT NULL DEFAULT 0
);
-- Internal sequencing table: no user data, no group_id — RLS must stay off.
ALTER TABLE invoice_sequences DISABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION next_invoice_number()
RETURNS VARCHAR(50) LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ym  CHAR(6) := TO_CHAR(NOW(), 'YYYYMM');
  v_seq INTEGER;
BEGIN
  INSERT INTO invoice_sequences (year_month, last_seq)
  VALUES (v_ym, 1)
  ON CONFLICT (year_month) DO UPDATE
    SET last_seq = invoice_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN 'KY-' || v_ym || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

-- ---------------------------------------------------------------------------
-- Loan repayment schedule generator (reducing balance)
-- Called once when a loan transitions to 'disbursed'.
-- Inserts one row per installment into loan_repayments.
--
-- Formula per period:
--   monthly_rate  = annual_rate / 12 / 100
--   EMI           = P * r * (1+r)^n / ((1+r)^n - 1)
--   interest      = opening_balance * monthly_rate
--   principal     = EMI - interest
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION generate_loan_schedule(p_loan_id UUID)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_loan          loans%ROWTYPE;
  v_monthly_rate  NUMERIC(20,10);
  v_emi           NUMERIC(15,2);
  v_balance       NUMERIC(15,2);
  v_interest      NUMERIC(15,2);
  v_principal     NUMERIC(15,2);
  v_due_date      DATE;
  i               INTEGER;
BEGIN
  SELECT * INTO v_loan FROM loans WHERE id = p_loan_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Loan % not found', p_loan_id;
  END IF;

  -- Delete any prior schedule (idempotent regeneration)
  DELETE FROM loan_repayments WHERE loan_id = p_loan_id;

  v_monthly_rate := v_loan.interest_rate / 12.0 / 100.0;
  v_balance      := v_loan.principal_amount;

  -- EMI = 0 for 0% interest loans (equal principal split)
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

  v_due_date := COALESCE(v_loan.disbursement_date, CURRENT_DATE);

  FOR i IN 1..v_loan.loan_term_months LOOP
    v_due_date  := v_due_date + INTERVAL '1 month';
    v_interest  := ROUND(v_balance * v_monthly_rate, 2);
    v_principal := LEAST(v_emi - v_interest, v_balance);  -- cap last installment

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

  -- Stamp denormalized totals on the parent loan record
  UPDATE loans SET
    total_repayable     = (SELECT SUM(total_due) FROM loan_repayments WHERE loan_id = p_loan_id),
    outstanding_balance = v_loan.principal_amount,
    next_payment_date   = (SELECT MIN(due_date) FROM loan_repayments WHERE loan_id = p_loan_id AND status = 'pending')
  WHERE id = p_loan_id;
END;
$$;

-- Trigger: auto-generate schedule when loan is disbursed
CREATE OR REPLACE FUNCTION trg_loan_on_disburse()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'disbursed' AND OLD.status IS DISTINCT FROM 'disbursed' THEN
    PERFORM generate_loan_schedule(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_loans_generate_schedule
  AFTER UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION trg_loan_on_disburse();

-- ---------------------------------------------------------------------------
-- Overdue marker: marks pending repayments as overdue when past due_date.
-- Called by a scheduled job (cron or application-level scheduler).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_overdue_repayments()
RETURNS INTEGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE loan_repayments
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  WITH updated2 AS (
    UPDATE contributions
    SET status = 'overdue'
    WHERE status = 'pending'
      AND due_date < CURRENT_DATE
    RETURNING id
  )
  SELECT v_count + COUNT(*) INTO v_count FROM updated2;

  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Subscription expiry enforcement
-- Returns groups whose subscription has expired (past grace period).
-- Application layer calls this and locks the affected groups.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_expired_subscriptions()
RETURNS TABLE(group_id UUID, plan_type plan_type, expired_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT
    s.group_id,
    s.plan_type,
    s.expires_at
  FROM subscriptions s
  WHERE s.status = 'active'
    AND s.expires_at IS NOT NULL
    AND s.expires_at < NOW() - (s.grace_period_days || ' days')::INTERVAL;
$$;
