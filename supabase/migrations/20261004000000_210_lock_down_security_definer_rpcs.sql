-- =============================================================================
-- 210: Close the PostgREST exposure on register_organization() and
-- register_campaign(), and stop this class of gap recurring.
--
-- Found by the Supabase security advisor (anon/authenticated_security_definer_
-- function_executable) against production on 2026-10-04.
--
--   register_organization(jsonb)   migration 206
--   register_campaign(jsonb)       migration 208
--
-- Both are SECURITY DEFINER and both were left executable by `anon` and
-- `authenticated`, so anyone holding the public Supabase key can call them at
-- POST /rest/v1/rpc/<name> and skip the app's own validation, rate limiting
-- and review flow (register_campaign exists specifically so a campaign lands
-- as 'pending_review'; calling it directly bypasses everything in front of it).
--
-- Why they were open: 206 and 208 each ended with
--     REVOKE EXECUTE ... FROM PUBLIC;  GRANT EXECUTE ... TO postgres;
-- which is the pattern migration 032 used for register_group. On a Supabase
-- project that is not enough: Supabase's default privileges also grant EXECUTE
-- on every new function to anon, authenticated and service_role *by name*, and
-- REVOKE FROM PUBLIC does not remove a direct grant. Migration 107 had to
-- close the same gap for three earlier functions. The earlier functions
-- (register_group, the verification RPCs, recompute_par_buckets) are only
-- locked in production because they existed when a blanket revoke was run by
-- hand; a database rebuilt from these migrations leaves them open.
--
-- The app is unaffected: it reaches these over its own pg pool (postgres, or
-- app_tenant after the ADR-001 cutover), never through PostgREST. service_role
-- and app_tenant keep the access they already have.
--
-- Three steps:
--   1. Revoke the two known-open functions.
--   2. Sweep: no SECURITY DEFINER function in public may be executable by
--      PUBLIC, anon or authenticated. In production this is a no-op beyond (1)
--      -- it makes a rebuilt database match production.
--   3. Default privileges: new functions in public stop being granted to
--      anon/authenticated automatically, so a future migration that forgets
--      the revoke is closed by default instead of open by default.
--      (Applies to functions created by the role running this migration.)
--
-- Idempotent: every statement is safe to re-run.
-- =============================================================================

-- ─── 1. The two known exposures ─────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.register_organization(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.register_campaign(jsonb)     FROM PUBLIC, anon, authenticated;

-- ─── 2. Sweep every SECURITY DEFINER function in public ─────────────────────

DO $$
DECLARE
  fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
  END LOOP;
END
$$;

-- ─── 3. Closed by default for functions created from now on ─────────────────

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
