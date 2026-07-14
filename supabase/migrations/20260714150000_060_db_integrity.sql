-- =============================================================================
-- 060_db_integrity.sql
-- Phase 3.1 of the payment architecture redesign (PAYMENT_ARCHITECTURE_REDESIGN.md
-- §6, §2.5; ADR-9):
--
--   1. Composite-FK target index on group_members (id, group_id, member_id)
--   2. group_membership_id on every member-scoped financial table:
--      backfill from (group_id, member_id) — deterministic under
--      group_members_unique — then composite FK, NOT VALID → VALIDATE.
--      Columns stay NULLABLE in this migration: the currently deployed code
--      does not write them yet. SET NOT NULL ships as migration 061 after the
--      code sweep is deployed and verified (zero-breakage cutover order).
--   3. loans guarantor bound to a membership of the same group (two-column FK)
--   4. generate_loan_schedule() propagates the loan's membership to its
--      installments; trg_apply_share_txn() propagates to share_holdings
--   5. Payment-spine immutability: mpesa_receipt_number write-once, amount
--      frozen, DELETE forbidden (corrections are contra-entries, §3.4)
--   6. Value-CHECK sweep: loan_repayments money columns
--   7. Auth epochs (§2.5): group_members.auth_version (trigger-bumped on
--      role/status change) + members.session_version. Claims wiring is
--      Phase 3.2; the columns and bump semantics land here.
--   8. journal_entries ledger attribution columns (§6e), nullable
-- =============================================================================

-- ─── 1. Composite-FK target ──────────────────────────────────────────────────

CREATE UNIQUE INDEX uq_gm_id_group_member
  ON group_members (id, group_id, member_id);

-- ─── 2. group_membership_id + backfill + composite FK ───────────────────────
-- Pollution audit 2026-07-14: zero rows without a matching membership, so
-- VALIDATE runs clean immediately.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'contributions', 'loans', 'loan_repayments', 'welfare_pool_contributions',
    'welfare_requests', 'share_transactions', 'share_holdings',
    'dividend_allocations'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN group_membership_id UUID', t);
    EXECUTE format(
      'UPDATE %I x SET group_membership_id = gm.id
       FROM group_members gm
       WHERE gm.group_id = x.group_id AND gm.member_id = x.member_id', t);
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT fk_%s_membership
       FOREIGN KEY (group_membership_id, group_id, member_id)
       REFERENCES group_members (id, group_id, member_id) NOT VALID', t, t);
    EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT fk_%s_membership', t, t);
    EXECUTE format('CREATE INDEX idx_%s_membership ON %I (group_membership_id)', t, t);
  END LOOP;
END $$;

-- payment_requests already carries the column (059); bind it the same way.
ALTER TABLE payment_requests
  ADD CONSTRAINT fk_payment_requests_membership
  FOREIGN KEY (group_membership_id, group_id, member_id)
  REFERENCES group_members (id, group_id, member_id) NOT VALID;
ALTER TABLE payment_requests VALIDATE CONSTRAINT fk_payment_requests_membership;

-- ─── 3. Guarantor must hold a membership in the loan's group ────────────────
-- Enforced via the existing UNIQUE (group_id, member_id); NULL guarantor skips.

ALTER TABLE loans
  ADD CONSTRAINT fk_loans_guarantor_membership
  FOREIGN KEY (group_id, guarantor_id)
  REFERENCES group_members (group_id, member_id) NOT VALID;
ALTER TABLE loans VALIDATE CONSTRAINT fk_loans_guarantor_membership;

-- ─── 4a. Loan schedule inherits the loan's membership ───────────────────────

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

-- ─── 4b. Share holdings inherit the transaction's membership ────────────────

CREATE OR REPLACE FUNCTION trg_apply_share_txn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cash_delta NUMERIC(15,2);
BEGIN
  v_cash_delta := CASE
    WHEN NEW.type = 'purchase'   THEN  NEW.total_amount
    WHEN NEW.type = 'redemption' THEN -NEW.total_amount
    ELSE 0
  END;

  INSERT INTO share_holdings (
    group_id, member_id, group_membership_id, share_class_id, quantity,
    total_invested, first_acquired_at, last_transaction_at
  ) VALUES (
    NEW.group_id, NEW.member_id, NEW.group_membership_id, NEW.share_class_id,
    NEW.quantity, v_cash_delta, NEW.posted_at, NEW.posted_at
  )
  ON CONFLICT (group_id, member_id, share_class_id) DO UPDATE SET
    quantity            = share_holdings.quantity        + NEW.quantity,
    total_invested      = GREATEST(share_holdings.total_invested + v_cash_delta, 0),
    first_acquired_at   = COALESCE(share_holdings.first_acquired_at, NEW.posted_at),
    last_transaction_at = NEW.posted_at,
    group_membership_id = COALESCE(EXCLUDED.group_membership_id,
                                   share_holdings.group_membership_id);

  IF (SELECT quantity FROM share_holdings
        WHERE group_id = NEW.group_id
          AND member_id = NEW.member_id
          AND share_class_id = NEW.share_class_id) < 0
  THEN
    RAISE EXCEPTION 'Transaction would create a negative share holding for this member/class'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 5. Payment-spine immutability (§6b) ─────────────────────────────────────
-- Legit UPDATEs: status transitions, receipt stamping (NULL → value),
-- allocation_status, raw callback, is_third_party. Never: changing a set
-- receipt, changing amount, DELETE.

CREATE OR REPLACE FUNCTION public.protect_payment_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.mpesa_receipt_number IS NOT NULL
     AND NEW.mpesa_receipt_number IS DISTINCT FROM OLD.mpesa_receipt_number THEN
    RAISE EXCEPTION 'payments.mpesa_receipt_number is write-once (corrections go through payment_reallocations)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount THEN
    RAISE EXCEPTION 'payments.amount is immutable (corrections go through payment_reallocations)'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_immutable
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.protect_payment_row();

CREATE OR REPLACE FUNCTION public.forbid_payment_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payments rows are never deleted (append-only spine, §3.4)'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER trg_payments_no_delete
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.forbid_payment_delete();

-- ─── 6. Value-CHECK sweep (§6d) ──────────────────────────────────────────────

ALTER TABLE loan_repayments
  ADD CONSTRAINT chk_loan_repayments_total_due   CHECK (total_due > 0)     NOT VALID,
  ADD CONSTRAINT chk_loan_repayments_amount_paid CHECK (amount_paid >= 0)  NOT VALID;
ALTER TABLE loan_repayments VALIDATE CONSTRAINT chk_loan_repayments_total_due;
ALTER TABLE loan_repayments VALIDATE CONSTRAINT chk_loan_repayments_amount_paid;

-- ─── 7. Auth epochs (§2.5) ───────────────────────────────────────────────────

ALTER TABLE group_members ADD COLUMN auth_version    INTEGER NOT NULL DEFAULT 1;
ALTER TABLE members       ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;

CREATE OR REPLACE FUNCTION public.bump_membership_auth_version()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.role    IS DISTINCT FROM OLD.role
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.status  IS DISTINCT FROM OLD.status THEN
    NEW.auth_version := OLD.auth_version + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_gm_bump_auth_version
  BEFORE UPDATE ON group_members
  FOR EACH ROW EXECUTE FUNCTION public.bump_membership_auth_version();

-- ─── 8. Ledger attribution (§6e) — columns only; wiring is Phase 3.2 ────────

ALTER TABLE journal_entries
  ADD COLUMN group_membership_id UUID REFERENCES group_members (id),
  ADD COLUMN member_id           UUID REFERENCES members (id);
