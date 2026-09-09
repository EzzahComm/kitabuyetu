-- =============================================================================
-- 015_fix_view_security_invoker.sql
-- Set security_invoker = true on all views in the public schema.
-- Without this, views run under the creator's (postgres superuser) privileges,
-- bypassing RLS on the underlying tables.
-- Requires PostgreSQL 15+ (supported on all current Supabase projects).
-- =============================================================================

ALTER VIEW public.vw_members_masked        SET (security_invoker = true);
ALTER VIEW public.vw_ngo_group_summary     SET (security_invoker = true);
ALTER VIEW public.vw_contributions_monthly SET (security_invoker = true);
ALTER VIEW public.vw_loan_portfolio        SET (security_invoker = true);
ALTER VIEW public.vw_trial_balance         SET (security_invoker = true);
ALTER VIEW public.vw_sms_usage_summary     SET (security_invoker = true);
