-- =============================================================================
-- 142: Close cross-tenant exposure on vw_sms_credit_reconciliation
--
-- Migration 141 created this view one migration ago and it shipped with a real
-- cross-tenant read hole. Caught by get_advisors immediately after applying —
-- which is the entire reason that check is run after DDL on this project.
--
-- TWO DEFAULTS COMBINED TO CAUSE IT, neither of them obvious:
--
--   1. A Postgres view runs with the PRIVILEGES OF ITS OWNER unless
--      `security_invoker` is set. The view is owned by `postgres`, so it reads
--      billing_accounts and organization_billing_accounts with RLS BYPASSED —
--      the row-level policies that protect those tables simply do not apply.
--
--   2. Supabase grants `anon` and `authenticated` full privileges on new
--      objects in the `public` schema by default. So the view was readable over
--      PostgREST by any self-registered Supabase Auth user.
--
-- Together: any signed-up user could read EVERY group's and organization's SMS
-- balance. The underlying tables were never exposed — billing_accounts' RLS
-- holds, and the sms_credit_ledger table is fine too (RLS on, SELECT policy
-- keyed to app_current_group_id(), and no INSERT policy at all so writes are
-- denied). The view was the only way through, because a SECURITY DEFINER view
-- is precisely a hole punched through RLS.
--
-- This is the same PostgREST-exposure class as migrations 126, 136 and the
-- dead function 141 itself dropped — the fourth instance on this project, and
-- the first caused by a VIEW rather than a function. Worth remembering that
-- `CREATE VIEW` needs the same grant hygiene as `CREATE FUNCTION` here.
-- =============================================================================

-- Run as the CALLER, so the RLS on billing_accounts and
-- organization_billing_accounts applies to anyone reading through this view.
ALTER VIEW public.vw_sms_credit_reconciliation SET (security_invoker = on);

-- Belt as well as braces: reconciliation is an operational concern, not a
-- tenant-facing one. Even with security_invoker on, no tenant role has any
-- business reading a cross-payer drift report.
REVOKE ALL ON public.vw_sms_credit_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_sms_credit_reconciliation TO service_role;

-- Defence in depth on the ledger table. RLS already blocks anon/authenticated
-- (the SELECT policy needs a session GUC PostgREST cannot set, and the absence
-- of an INSERT policy denies writes outright), but a table-level grant that
-- nothing legitimately uses is one policy change away from mattering — and
-- migration 141 exists partly because an unused grant sat around long enough
-- to be forgotten.
REVOKE ALL ON public.sms_credit_ledger FROM anon, authenticated;
GRANT SELECT, INSERT ON public.sms_credit_ledger TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    -- app_tenant reads its own rows through RLS; it never writes directly
    -- (sms_ledger_append is SECURITY DEFINER and does the insert).
    EXECUTE 'GRANT SELECT ON public.sms_credit_ledger TO app_tenant';
    EXECUTE 'GRANT SELECT ON public.vw_sms_credit_reconciliation TO app_tenant';
  END IF;
END $do$;
