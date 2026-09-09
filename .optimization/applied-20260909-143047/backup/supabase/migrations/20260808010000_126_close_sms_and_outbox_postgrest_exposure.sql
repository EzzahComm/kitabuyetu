-- =============================================================================
-- 126: Close three PostgREST exposures found via a live Supabase Advisor pass
-- against production (2026-08-08), the same bug class migration 107 already
-- fixed once ("written on the assumption that only the app's own DB roles
-- could reach it") recurring in code shipped after that migration landed.
--
-- This app never uses PostgREST/supabase-js for real traffic — confirmed by
-- grep: lib/supabase/server.ts and client.ts (the only @supabase/ssr client
-- wrappers in the codebase) have zero importers anywhere. All business logic
-- reaches Postgres over a raw `pg` pool (`postgres` admin role today,
-- `app_tenant` post-cutover). Every grant this migration revokes from
-- anon/authenticated is therefore pure attack surface with no functional
-- benefit — applied to production ahead of this file via manual REVOKE,
-- verified, and codified here so a fresh build/CI replay matches production.
--
--   1. reserve_sms_credits / settle_sms_credit_reservation (migrations 123,
--      125) were granted EXECUTE to `authenticated` when the SMS credit
--      reservation feature was built, mirroring a pattern that was already
--      wrong elsewhere once (migration 107). Both are SECURITY DEFINER, owned
--      by `postgres` (rolbypassrls = true), and neither performs an internal
--      check that the caller is actually authorized for the p_group_id /
--      p_organization_id it was handed. Confirmed exploitable: Supabase Auth
--      signup is enabled for this project (`disable_signup: false` at
--      /auth/v1/settings) despite auth.users having 0 rows — anyone could
--      self-register, obtain a real `authenticated` JWT, and call either RPC
--      via POST /rest/v1/rpc/<name> with an arbitrary group_id/organization_id,
--      completely bypassing this app's own custom-JWT authorization layer and
--      the app_tenant RLS cutover (irrelevant here — SECURITY DEFINER runs as
--      the owner, not the caller).
--
--   2. event_outbox / membership_no_counters both carry a `FOR ALL USING
--      (true) WITH CHECK (true)` policy (migrations 057, 056) — a deliberate
--      choice at the time (system plumbing written by tenant AND admin
--      transactions alike, no group_id column to scope by), but combined with
--      Supabase's standard default table grant (full CRUD to anon/authenticated
--      on every new public-schema table — safe everywhere else in this schema
--      *because* real per-tenant RLS policies constrain it) it means RLS
--      provides ZERO backstop for these two specific tables. Verified live:
--      event_outbox.payload contains real cross-tenant financial data (payment
--      amounts, group_id, contribution_id, receipt numbers) — contradicting
--      migration 057's own comment ("no tenant data beyond ids") — and was
--      readable by the bare `anon` role with no authentication of any kind,
--      plus writable/truncatable by the same. membership_no_counters carries
--      no real data (a 2-char prefix + a sequence integer) but the same
--      unauthenticated write access could corrupt the shared counter.
--
-- Scope note: this migration does NOT touch the anon/authenticated grants on
-- any other public-schema table. Every other table's broad default grant is
-- Supabase's own intended architecture (RLS is the enforcement layer, grants
-- define only what's POSSIBLE) and is safe wherever real per-tenant RLS
-- policies exist — auditing all ~130 tables for a genuine `USING(true)` gap
-- the way this migration does for these two specific, already-flagged tables
-- is out of scope here.
-- =============================================================================

-- ─── 1. SMS credit reservation RPCs ──────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT)
  FROM authenticated;

-- ─── 2. Outbox + counter tables ──────────────────────────────────────────────

REVOKE ALL ON public.event_outbox FROM anon, authenticated;
REVOKE ALL ON public.membership_no_counters FROM anon, authenticated;
