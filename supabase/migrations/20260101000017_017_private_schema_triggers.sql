-- =============================================================================
-- 017_private_schema_triggers.sql
--
-- Move all SECURITY DEFINER trigger functions out of the public schema into a
-- dedicated `private` schema. Supabase exposes only the `public` schema via
-- /rest/v1/rpc — functions in `private` are invisible to the REST API and
-- therefore cannot be called by the anon role regardless of EXECUTE grants.
--
-- Also fixes is_super_admin() search_path (missed in migration 016).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Create the private schema and lock it down
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;

-- Supabase grants EXECUTE on ALL functions in public to anon/authenticated.
-- The private schema is NOT in that blanket grant, so only postgres and
-- service_role (which bypass RLS anyway) can use functions here.
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT  USAGE ON SCHEMA private TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- Recreate trigger functions in private schema
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = private, public AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_logs_immutable()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = private, public AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs rows are immutable';
END;
$$;

CREATE OR REPLACE FUNCTION private.audit_sensitive_change()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = private, public AS $$
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

  INSERT INTO public.audit_logs (
    group_id, actor_id, action,
    resource_type, resource_id, old_values, new_values
  ) VALUES (
    public.app_current_group_id(),
    public.app_current_user_id(),
    TG_OP || '.' || v_resource_type,
    v_resource_type,
    v_resource_id,
    v_old_values,
    v_new_values
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.validate_journal_balance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = private, public AS $$
DECLARE
  v_sum_debits  NUMERIC(15,2);
  v_sum_credits NUMERIC(15,2);
BEGIN
  IF NEW.status = 'posted' AND (OLD.status IS DISTINCT FROM 'posted') THEN
    SELECT
      COALESCE(SUM(debit),  0),
      COALESCE(SUM(credit), 0)
    INTO v_sum_debits, v_sum_credits
    FROM public.journal_lines
    WHERE journal_entry_id = NEW.id;

    IF v_sum_debits <> v_sum_credits THEN
      RAISE EXCEPTION
        'Journal entry % is unbalanced: debits=% credits=%',
        NEW.id, v_sum_debits, v_sum_credits;
    END IF;

    IF v_sum_debits = 0 THEN
      RAISE EXCEPTION 'Journal entry % has no lines', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.update_account_balance()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = private, public AS $$
DECLARE
  v_entry_status public.journal_status;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO v_entry_status
    FROM public.journal_entries WHERE id = OLD.journal_entry_id;
  ELSE
    SELECT status INTO v_entry_status
    FROM public.journal_entries WHERE id = NEW.journal_entry_id;
  END IF;

  IF v_entry_status <> 'posted' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    UPDATE public.accounts SET balance = balance + NEW.debit - NEW.credit WHERE id = NEW.account_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.accounts SET balance = balance - OLD.debit + OLD.credit WHERE id = OLD.account_id;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.accounts
    SET balance = balance - OLD.debit + OLD.credit + NEW.debit - NEW.credit
    WHERE id = NEW.account_id;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.trg_loan_on_disburse()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = private, public AS $$
BEGIN
  IF NEW.status = 'disbursed' AND OLD.status IS DISTINCT FROM 'disbursed' THEN
    PERFORM public.generate_loan_schedule(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Rewire all triggers to use private schema functions
-- ---------------------------------------------------------------------------

-- set_updated_at triggers — drop existing and recreate pointing to private
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'groups','members','group_members','refresh_tokens',
    'contributions','loans','loan_repayments',
    'accounts','journal_entries','journal_lines',
    'billing_accounts','subscriptions','invoices','invoice_items','payments',
    'sms_usage_logs','sms_credits',
    'ngos','ngo_group_access',
    'notifications'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at
       BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION private.set_updated_at()',
      tbl, tbl
    );
  END LOOP;
END;
$$;

-- Explicit rewire for email/billing triggers (from migration 014)
DROP TRIGGER IF EXISTS trg_email_branding_updated    ON group_email_branding;
DROP TRIGGER IF EXISTS trg_email_templates_updated   ON email_templates;
DROP TRIGGER IF EXISTS trg_email_campaigns_updated   ON email_campaigns;
DROP TRIGGER IF EXISTS trg_email_schedules_updated   ON email_schedules;
DROP TRIGGER IF EXISTS trg_email_failures_updated    ON email_failures;
DROP TRIGGER IF EXISTS trg_email_preferences_updated ON email_preferences;
DROP TRIGGER IF EXISTS trg_notification_rules_updated ON notification_rules;
DROP TRIGGER IF EXISTS trg_receipts_updated          ON payment_receipts;
DROP TRIGGER IF EXISTS trg_inv_schedules_updated     ON invoice_schedules;
DROP TRIGGER IF EXISTS trg_email_logs_updated        ON email_logs;

CREATE TRIGGER trg_email_branding_updated     BEFORE UPDATE ON group_email_branding    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_email_templates_updated    BEFORE UPDATE ON email_templates          FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_email_campaigns_updated    BEFORE UPDATE ON email_campaigns          FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_email_schedules_updated    BEFORE UPDATE ON email_schedules          FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_email_failures_updated     BEFORE UPDATE ON email_failures           FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_email_preferences_updated  BEFORE UPDATE ON email_preferences        FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_notification_rules_updated BEFORE UPDATE ON notification_rules       FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_receipts_updated           BEFORE UPDATE ON payment_receipts         FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_inv_schedules_updated      BEFORE UPDATE ON invoice_schedules        FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_email_logs_updated         BEFORE UPDATE ON email_logs               FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- M-Pesa triggers (from migration 014_mpesa)
DROP TRIGGER IF EXISTS trg_mpesa_tx_updated_at        ON mpesa_transactions;
DROP TRIGGER IF EXISTS trg_stk_updated_at             ON mpesa_stk_requests;
DROP TRIGGER IF EXISTS trg_b2c_tx_updated_at          ON mpesa_b2c_transactions;
DROP TRIGGER IF EXISTS trg_b2b_tx_updated_at          ON mpesa_b2b_transactions;
DROP TRIGGER IF EXISTS trg_reversals_updated_at       ON mpesa_reversals;
DROP TRIGGER IF EXISTS trg_reconciliations_updated_at ON mpesa_reconciliations;
DROP TRIGGER IF EXISTS trg_failed_logs_updated_at     ON failed_payment_logs;
DROP TRIGGER IF EXISTS trg_bill_mgr_updated_at        ON bill_manager_invoices;

CREATE TRIGGER trg_mpesa_tx_updated_at        BEFORE UPDATE ON mpesa_transactions    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_stk_updated_at             BEFORE UPDATE ON mpesa_stk_requests    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_b2c_tx_updated_at          BEFORE UPDATE ON mpesa_b2c_transactions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_b2b_tx_updated_at          BEFORE UPDATE ON mpesa_b2b_transactions FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_reversals_updated_at       BEFORE UPDATE ON mpesa_reversals        FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_reconciliations_updated_at BEFORE UPDATE ON mpesa_reconciliations  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_failed_logs_updated_at     BEFORE UPDATE ON failed_payment_logs    FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_bill_mgr_updated_at        BEFORE UPDATE ON bill_manager_invoices  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- SMS advanced triggers (from migration 013)
DROP TRIGGER IF EXISTS trg_sms_group_settings_updated ON sms_group_settings;
DROP TRIGGER IF EXISTS trg_sms_templates_updated      ON sms_templates;
DROP TRIGGER IF EXISTS trg_sms_campaigns_updated      ON sms_campaigns;
DROP TRIGGER IF EXISTS trg_sms_schedules_updated      ON sms_schedules;
DROP TRIGGER IF EXISTS trg_sms_failures_updated       ON sms_failures;

CREATE TRIGGER trg_sms_group_settings_updated BEFORE UPDATE ON sms_group_settings FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_sms_templates_updated      BEFORE UPDATE ON sms_templates       FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_sms_campaigns_updated      BEFORE UPDATE ON sms_campaigns       FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_sms_schedules_updated      BEFORE UPDATE ON sms_schedules       FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();
CREATE TRIGGER trg_sms_failures_updated       BEFORE UPDATE ON sms_failures        FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- audit_logs immutability triggers
DROP TRIGGER IF EXISTS trg_audit_logs_no_update ON audit_logs;
DROP TRIGGER IF EXISTS trg_audit_logs_no_delete ON audit_logs;

CREATE TRIGGER trg_audit_logs_no_update
  BEFORE UPDATE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.audit_logs_immutable();

CREATE TRIGGER trg_audit_logs_no_delete
  BEFORE DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION private.audit_logs_immutable();

-- audit_sensitive_change triggers
DROP TRIGGER IF EXISTS trg_members_audit       ON members;
DROP TRIGGER IF EXISTS trg_loans_audit         ON loans;
DROP TRIGGER IF EXISTS trg_contributions_audit ON contributions;
DROP TRIGGER IF EXISTS trg_payments_audit      ON payments;
DROP TRIGGER IF EXISTS trg_subscriptions_audit ON subscriptions;

CREATE TRIGGER trg_members_audit
  AFTER INSERT OR UPDATE OR DELETE ON members
  FOR EACH ROW EXECUTE FUNCTION private.audit_sensitive_change('member');

CREATE TRIGGER trg_loans_audit
  AFTER INSERT OR UPDATE OR DELETE ON loans
  FOR EACH ROW EXECUTE FUNCTION private.audit_sensitive_change('loan');

CREATE TRIGGER trg_contributions_audit
  AFTER INSERT OR UPDATE OR DELETE ON contributions
  FOR EACH ROW EXECUTE FUNCTION private.audit_sensitive_change('contribution');

CREATE TRIGGER trg_payments_audit
  AFTER INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION private.audit_sensitive_change('payment');

CREATE TRIGGER trg_subscriptions_audit
  AFTER INSERT OR UPDATE OR DELETE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION private.audit_sensitive_change('subscription');

-- journal_entries balance + journal_lines balance triggers
DROP TRIGGER IF EXISTS trg_journal_entries_validate_balance ON journal_entries;
DROP TRIGGER IF EXISTS trg_journal_lines_update_balance     ON journal_lines;
DROP TRIGGER IF EXISTS trg_loans_generate_schedule          ON loans;

CREATE TRIGGER trg_journal_entries_validate_balance
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION private.validate_journal_balance();

CREATE TRIGGER trg_journal_lines_update_balance
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION private.update_account_balance();

CREATE TRIGGER trg_loans_generate_schedule
  AFTER UPDATE ON loans
  FOR EACH ROW EXECUTE FUNCTION private.trg_loan_on_disburse();

-- ---------------------------------------------------------------------------
-- Drop the now-unused public schema trigger functions
-- (triggers have been rewired above; these are no longer referenced)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_updated_at();
DROP FUNCTION IF EXISTS public.audit_logs_immutable();
DROP FUNCTION IF EXISTS public.audit_sensitive_change();
DROP FUNCTION IF EXISTS public.validate_journal_balance();
DROP FUNCTION IF EXISTS public.update_account_balance();
DROP FUNCTION IF EXISTS public.trg_loan_on_disburse();

-- ---------------------------------------------------------------------------
-- Fix is_super_admin() search_path (missed in migration 016)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT public.app_current_role() = 'super_admin';
$$;
