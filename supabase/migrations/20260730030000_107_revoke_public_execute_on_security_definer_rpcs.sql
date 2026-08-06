-- =============================================================================
-- 107: Close two open Supabase Security Advisor findings against production.
--
-- Found by PRODUCTION_SCHEMA_DRIFT_AUDIT.md (2026-07-30) — the first audit in
-- this series with a live connection to the production database, which is the
-- only way either of these was visible: both are *grant* state, not DDL, so
-- nothing in this repository could have revealed them.
--
--   1. anon/authenticated_security_definer_function_executable (Critical).
--      Postgres grants EXECUTE to PUBLIC by default on every new function.
--      Migrations 098 and 100 created three SECURITY DEFINER functions and
--      never revoked it, so all three are reachable unauthenticated at
--      POST /rest/v1/rpc/<name> (supabase/config.toml exposes the `public`
--      schema to PostgREST). They run as the owner — `postgres`, which has
--      rolbypassrls — so no RLS policy constrains them, and none of the three
--      performs an internal authorization check of its own: each was written
--      on the assumption that only the app's own DB roles could reach it.
--
--        - link_member_to_group            inserts an `active` group_members
--                                          row with a caller-supplied
--                                          member_role. Cross-tenant
--                                          privilege escalation.
--        - adjust_account_reserved_amount  arbitrary signed delta on
--                                          accounts.reserved_amount — the
--                                          earmark that gates disbursement
--                                          approval.
--        - lock_group_cash_account         discloses balance/reserved_amount
--                                          for any group's account and holds
--                                          a FOR UPDATE lock.
--
--      Verified against production: every other SECURITY DEFINER function in
--      the database already has anon/authenticated execute revoked. These
--      three are the only exceptions. Migration 105 closed exactly this
--      finding for debit_organization_sms_credits without noticing them.
--
--      This restores the pattern migration 032 established for register_group:
--      REVOKE from PUBLIC, then GRANT back only to the roles that need it.
--      The app itself is unaffected — it reaches all three over its own pg
--      pool (postgres today, app_tenant after the ADR-001 cutover), never
--      through PostgREST.
--
--   2. function_search_path_mutable (Low, 2 functions). Migration 105 pinned
--      search_path on the eight functions the advisor flagged at the time.
--      These two, from migration 091, were applied to production out of order
--      (see commit bb2fc68 — 091 was missed and applied late), so they were
--      not in 105's enumeration and are now the project's last two open
--      instances. Neither is SECURITY DEFINER, so exposure is low. Uses
--      ALTER FUNCTION ... SET rather than CREATE OR REPLACE so neither
--      trigger body is retyped.
-- =============================================================================

-- ─── 1. Revoke the default PUBLIC execute grant ─────────────────────────────
-- REVOKE FROM PUBLIC covers anon/authenticated (both inherit it); the explicit
-- role revokes are belt-and-braces in case a direct grant was ever added.

REVOKE EXECUTE ON FUNCTION public.link_member_to_group(
  uuid, uuid, public.member_role, text, text, text, text, date, public.gender, date, uuid
) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.adjust_account_reserved_amount(uuid, numeric)
  FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.lock_group_cash_account(uuid, text)
  FROM PUBLIC, anon, authenticated;

-- Grant back to the roles that actually call them. `postgres` is the current
-- application connection role (and the owner, so this is really just explicit
-- documentation of intent).

GRANT EXECUTE ON FUNCTION public.link_member_to_group(
  uuid, uuid, public.member_role, text, text, text, text, date, public.gender, date, uuid
) TO postgres;

GRANT EXECUTE ON FUNCTION public.adjust_account_reserved_amount(uuid, numeric)
  TO postgres;

GRANT EXECUTE ON FUNCTION public.lock_group_cash_account(uuid, text)
  TO postgres;

-- `app_tenant` (ADR-001's least-privileged role) is granted only if it already
-- exists. Ordering differs by environment and both must work:
--
--   - CI (.github/workflows/ci.yml) applies every migration first and only
--     then runs scripts/ops/create-app-tenant-role.sql, so at this point in a
--     CI run the role does NOT exist — an unconditional GRANT would abort the
--     migration. The provisioning script's own blanket
--     `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_tenant`
--     covers these three moments later.
--   - Production already has the role provisioned (verified 2026-07-30:
--     rolcanlogin = true, rolbypassrls = false), so this branch runs and keeps
--     it whole without needing the provisioning script re-run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    GRANT EXECUTE ON FUNCTION public.link_member_to_group(
      uuid, uuid, public.member_role, text, text, text, text, date, public.gender, date, uuid
    ) TO app_tenant;
    GRANT EXECUTE ON FUNCTION public.adjust_account_reserved_amount(uuid, numeric) TO app_tenant;
    GRANT EXECUTE ON FUNCTION public.lock_group_cash_account(uuid, text)           TO app_tenant;
  END IF;
END $$;

-- ─── 2. Pin search_path on migration 091's two trigger functions ────────────

ALTER FUNCTION public.derive_journal_line_entry_date() SET search_path = public;
ALTER FUNCTION public.sync_journal_lines_entry_date()  SET search_path = public;
