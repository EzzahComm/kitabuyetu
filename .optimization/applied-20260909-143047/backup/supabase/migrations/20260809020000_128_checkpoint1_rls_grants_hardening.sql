-- =============================================================================
-- 128: Checkpoint 1 (PRODUCTION_READINESS_AUDIT Pass 1, docs/audit/
-- 01-HYPOTHESIS-VERIFICATION.md) — two small, independently-verified RLS/grant
-- fixes, same surgical scope as migration 126 rather than a blanket schema-wide
-- change (126's own comment is explicit that the broad anon/authenticated
-- default grant is this project's intended architecture wherever real
-- per-tenant RLS exists — this migration only touches the two tables that
-- don't fit that assumption).
--
--   1. invoice_sequences (20260101000008_009_functions_triggers.sql:271)
--      deliberately has RLS disabled — "no user data, no group_id" — a
--      reasoned design choice for a global, non-tenant sequence counter, not
--      an oversight, and left untouched here. But it still carried
--      REFERENCES/TRIGGER/TRUNCATE grants to anon/authenticated (Supabase's
--      standard default-grant set minus the four DML verbs, for reasons not
--      reconstructible from history). Re-verified before writing this: none
--      of the three privileges are reachable via PostgREST's REST API (no
--      verb maps to any of them) and no function anywhere in the schema
--      executes a TRUNCATE against this or any other table (only
--      scripts/clear-tenant-data.sql does, a manual ops script never exposed
--      to the app) — so this is hygiene, not closing a live hole. Revoking
--      costs nothing: the app never connects as anon/authenticated.
--
--   2. bill_manager_invoices' single RLS policy (rls_bill_manager_invoices_
--      group) scopes purely by group_id, with no is_super_admin() carve-out —
--      unlike its two sibling single-policy financial tables (payments_all,
--      invoices_all), which both read `(SELECT is_super_admin()) OR group_id
--      = ...`. Inert today (the app's admin pool connects as `postgres`,
--      which carries BYPASSRLS and never reaches any policy at all), but
--      would silently deny a super_admin session scoped access to this one
--      table specifically if the app_tenant cutover is ever extended to
--      platform-staff requests too. Aligning it now costs nothing and removes
--      a real inconsistency between three tables that should behave alike.
-- =============================================================================

-- ─── 1. invoice_sequences: drop the three inert, unreachable grants ─────────

REVOKE ALL ON public.invoice_sequences FROM anon, authenticated;

-- ─── 2. bill_manager_invoices: match payments_all / invoices_all's shape ────

ALTER POLICY rls_bill_manager_invoices_group ON public.bill_manager_invoices
  USING (
    (SELECT is_super_admin())
    OR (group_id)::text = (SELECT current_setting('app.current_group_id', true))
  );
