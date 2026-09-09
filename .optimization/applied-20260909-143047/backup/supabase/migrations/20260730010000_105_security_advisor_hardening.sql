-- =============================================================================
-- Security Advisor hardening — closes two classes of finding from Supabase's
-- database linter.
--
--   1. function_search_path_mutable (WARN, 8 functions): none of these
--      trigger functions pin `search_path`, so identifier resolution (the
--      unqualified `groups`/`journal_lines`/`fiscal_periods`/
--      `organization_journal_lines`/`organization_journal_entries`/
--      `organization_accounts` references inside their bodies) depends on
--      the calling session's search_path rather than being fixed to
--      `public`. None of these are SECURITY DEFINER today, so the practical
--      exposure is low (they run as whatever role fires the triggering DML,
--      not an elevated owner) — but pinning search_path is cheap, has zero
--      behavioral effect (identical resolution to today's default `public`
--      search_path), and closes off the risk if any of these are ever made
--      SECURITY DEFINER later. Uses ALTER FUNCTION ... SET, not
--      CREATE OR REPLACE, so none of the trigger bodies are retyped —
--      zero chance of a transcription bug in a live money-posting trigger.
--
--   2. authenticated_security_definer_function_executable (WARN, 1
--      function): debit_organization_sms_credits (migration 051) is
--      SECURITY DEFINER and was GRANTed EXECUTE to `authenticated` —
--      contradicting its own header comment ("never callable by anon").
--      `authenticated` is not a safe bar: Supabase Auth signup mints a
--      real `authenticated`-role JWT for any visitor by default, and that
--      JWT can call this function directly via
--      POST /rest/v1/rpc/debit_organization_sms_credits, bypassing the only
--      real authorization check (that the caller's own organizationId
--      matches the campaign's funding org — app/api/v1/sms/campaign/
--      route.ts:55) entirely, since the function itself only verifies the
--      group/organization pair has an active access row, not who's asking.
--      Confirmed the app itself never needs this grant — sms.service.ts
--      calls the function via a plain `SELECT ... FROM
--      debit_organization_sms_credits(...)` over the app's own pg pool
--      (BYPASSRLS role), never through PostgREST.
-- =============================================================================

-- ─── 1. Pin search_path on the 8 flagged trigger functions ──────────────────

ALTER FUNCTION public.protect_payment_row()                    SET search_path = public;
ALTER FUNCTION public.forbid_payment_delete()                   SET search_path = public;
ALTER FUNCTION public.bump_membership_auth_version()            SET search_path = public;
ALTER FUNCTION public.assert_journal_maker_checker()             SET search_path = public;
ALTER FUNCTION public.assert_period_open()                       SET search_path = public;
ALTER FUNCTION public.validate_organization_journal_balance()    SET search_path = public;
ALTER FUNCTION public.assert_org_posted_entry_balance()          SET search_path = public;
ALTER FUNCTION public.update_organization_account_balance()     SET search_path = public;

-- ─── 2. Close the authenticated-role RPC exposure ───────────────────────────

REVOKE EXECUTE ON FUNCTION public.debit_organization_sms_credits(UUID, UUID, INTEGER)
  FROM authenticated;
