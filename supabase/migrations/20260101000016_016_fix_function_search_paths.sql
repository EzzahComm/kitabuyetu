-- =============================================================================
-- 016_fix_function_search_paths.sql
-- Set a fixed search_path on every function in the public schema.
-- Without this, a user can manipulate search_path to redirect function calls
-- to a rogue schema (schema injection / privilege escalation risk).
-- Setting search_path = public pins all unqualified name lookups to public.
-- =============================================================================

-- Session context helpers (009)
ALTER FUNCTION public.app_current_group_id()  SET search_path = public;
ALTER FUNCTION public.app_current_user_id()   SET search_path = public;
ALTER FUNCTION public.app_current_role()      SET search_path = public;
ALTER FUNCTION public.app_current_ngo_id()    SET search_path = public;

-- Trigger functions (009)
ALTER FUNCTION public.set_updated_at()           SET search_path = public;
ALTER FUNCTION public.audit_sensitive_change()   SET search_path = public;
ALTER FUNCTION public.validate_journal_balance() SET search_path = public;
ALTER FUNCTION public.update_account_balance()   SET search_path = public;
ALTER FUNCTION public.trg_loan_on_disburse()     SET search_path = public;

-- Business logic functions (009)
ALTER FUNCTION public.deduct_sms_credits(UUID, NUMERIC)  SET search_path = public;
ALTER FUNCTION public.next_invoice_number()               SET search_path = public;
ALTER FUNCTION public.generate_loan_schedule(UUID)        SET search_path = public;
ALTER FUNCTION public.mark_overdue_repayments()           SET search_path = public;
ALTER FUNCTION public.get_expired_subscriptions()         SET search_path = public;

-- PII masking helpers (011)
ALTER FUNCTION public.mask_phone(TEXT)       SET search_path = public;
ALTER FUNCTION public.mask_email(TEXT)       SET search_path = public;
ALTER FUNCTION public.mask_national_id(TEXT) SET search_path = public;

-- Receipt numbering (014)
ALTER FUNCTION public.next_receipt_number() SET search_path = public;

-- Audit immutability trigger (008) — missed in initial pass
ALTER FUNCTION public.audit_logs_immutable() SET search_path = public;

-- ---------------------------------------------------------------------------
-- invoice_sequences: internal sequencing table — RLS must be off.
-- It has no group_id / user data so RLS is semantically meaningless, and
-- with no policy every row is invisible, silently breaking next_invoice_number().
-- ---------------------------------------------------------------------------
ALTER TABLE public.invoice_sequences DISABLE ROW LEVEL SECURITY;

-- Make next_invoice_number() SECURITY DEFINER so it always has access to the
-- sequence table regardless of the calling user's privileges or future RLS changes.
CREATE OR REPLACE FUNCTION public.next_invoice_number()
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
-- Revoke direct API access from trigger-only SECURITY DEFINER functions.
-- PostgreSQL grants EXECUTE to PUBLIC by default; Supabase exposes public-schema
-- functions via /rest/v1/rpc. These are internal trigger functions — they must
-- never be callable directly by anon or authenticated users.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.audit_sensitive_change()   FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.audit_logs_immutable()     FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_updated_at()           FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.validate_journal_balance() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_account_balance()   FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_loan_on_disburse()     FROM anon, authenticated, public;
