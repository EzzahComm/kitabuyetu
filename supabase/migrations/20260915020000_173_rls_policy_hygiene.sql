-- =============================================================================
-- 173_rls_policy_hygiene.sql
-- Bounded, low-blast-radius fixes from the 2026-09 optimization audit's
-- rls-policy-cost dimension (docs/audits/optimization-2026-09/verified/
-- rls-policy-cost-and-correctness-of-cost.json). Every change here is
-- semantic-preserving (same authorization outcome, different evaluation
-- shape) — verified against live pg_policies text before writing this file,
-- not just the audit's citations.
--
-- Deliberately NOT included (large DDL surface, needs its own dedicated
-- pass with before/after authorization verification, not bundled here):
--   - 176 policies across 113 tables with unwrapped app_current_*()/
--     is_super_admin() calls (finding: SET search_path blocks inlining).
--   - 47 policies on 42 tables casting group_id to text instead of casting
--     the GUC to uuid (finding: rls-unindexable-predicate).
--   - 130 policies using `is_super_admin() OR group_id=...`, unindexable
--     even after wrapping (finding: rls-unindexable-predicate, "large"
--     effort, needs a product decision on whether to drop the OR branch).
--   - 5 tables missing a leading index on their organization_id RLS branch
--     (finder's own recommendation: defer, bundle with the OR-shape fix).
--   - 80 unused group_id-leading indexes (finder's own recommendation: fix
--     the policies first, re-measure idx_scan, only then consider dropping).
-- =============================================================================

-- ── 1. email_logs.provider_message_id has no index ─────────────────────────
-- Every UPDATE in lib/services/delivery-tracking.service.ts filters on this
-- column via withAdminDb (BYPASSRLS) — confirmed RLS plays no role here,
-- this is a plain missing-index problem. Live: 1,427 UPDATE calls, mean
-- 18.77ms; email_logs itself seq-scanned 56.7M tuples across 1,784 scans.
CREATE INDEX IF NOT EXISTS idx_email_logs_provider_message_id
  ON public.email_logs (provider_message_id);

-- ── 2. Migration 131 silently reverted migration 120's RLS perf fix ────────
-- 120 wrapped current_setting(...) in a sub-select on these three policies
-- (a genuine cost fix). 131's DROP+CREATE for an unrelated chairperson-rename
-- fix reintroduced the unwrapped, non-inlinable form on all three, live for
-- ~4 weeks, still flagged by today's advisor. ALTER POLICY only touches the
-- qual — the role lists (migration 131's actual content) are untouched.
ALTER POLICY rls_contact_subs ON public.contact_submissions
  USING ((SELECT current_setting('app.current_role', true)) = ANY (ARRAY['super_admin', 'chairperson']));

ALTER POLICY rls_mpesa_callbacks_admin ON public.mpesa_callbacks
  USING ((SELECT current_setting('app.current_role', true)) = ANY (ARRAY['super_admin', 'chairperson']));

ALTER POLICY rls_sms_balances_admin ON public.sms_provider_balances
  USING ((SELECT current_setting('app.current_role', true)) = ANY (ARRAY['super_admin', 'chairperson', 'treasurer']));

-- ── 3. Duplicate / redundant permissive policies (5 tables, advisor's 35 = 5x7 roles) ──

-- meeting_attendance / meeting_resolutions: the SELECT policy's qual is
-- BYTE-IDENTICAL to the FOR ALL policy's qual, which already covers SELECT.
-- Pure duplication — drop the redundant SELECT-only policy.
DROP POLICY attendance_read ON public.meeting_attendance;
DROP POLICY resolutions_read ON public.meeting_resolutions;

-- organization_subscriptions: organization_subscriptions_admin_write (FOR
-- ALL, is_super_admin() both sides) double-evaluates alongside
-- organization_subscriptions_select on every SELECT — the entitlement hot
-- path for getEffectiveLimits/getOrganizationPlan/assertReportsAccess/
-- assertWhiteLabelAccess. Narrowed to INSERT/UPDATE/DELETE, same pattern
-- already applied to organization_disbursements in migration 122 — Postgres
-- has no single-statement way to change a policy's FOR clause, so this is a
-- DROP + per-command CREATE rather than an ALTER.
DROP POLICY organization_subscriptions_admin_write ON public.organization_subscriptions;

CREATE POLICY organization_subscriptions_insert ON public.organization_subscriptions
  FOR INSERT WITH CHECK ((SELECT is_super_admin()));
CREATE POLICY organization_subscriptions_update ON public.organization_subscriptions
  FOR UPDATE USING ((SELECT is_super_admin())) WITH CHECK ((SELECT is_super_admin()));
CREATE POLICY organization_subscriptions_delete ON public.organization_subscriptions
  FOR DELETE USING ((SELECT is_super_admin()));

-- feature_flags: feature_flags_read (SELECT, qual=true — flags are meant to
-- be publicly readable) already makes feature_flags_write's SELECT coverage
-- redundant (true OR anything = true). Same narrowing as above.
DROP POLICY feature_flags_write ON public.feature_flags;

CREATE POLICY feature_flags_insert ON public.feature_flags
  FOR INSERT WITH CHECK ((SELECT current_setting('app.current_role', true)) = 'super_admin');
CREATE POLICY feature_flags_update ON public.feature_flags
  FOR UPDATE USING ((SELECT current_setting('app.current_role', true)) = 'super_admin')
  WITH CHECK ((SELECT current_setting('app.current_role', true)) = 'super_admin');
CREATE POLICY feature_flags_delete ON public.feature_flags
  FOR DELETE USING ((SELECT current_setting('app.current_role', true)) = 'super_admin');

-- platform_notifications: the opposite shape from the two above — here
-- WRITE stays FOR ALL (it's what gives super_admin read access via
-- cross-policy OR), and READ's own redundant `OR super_admin` branch is
-- simplified away: PERMISSIVE policies OR-combine per command, so
-- (is_active=true OR super_admin) OR (super_admin, from write) is exactly
-- equivalent to is_active=true OR (super_admin, from write) — same result,
-- one fewer branch evaluated on every read. Also wrapped write's
-- current_setting() for the same InitPlan-hoisting reason as item 2 above.
ALTER POLICY platform_notifications_read ON public.platform_notifications
  USING (is_active = true);
ALTER POLICY platform_notifications_write ON public.platform_notifications
  USING ((SELECT current_setting('app.current_role', true)) = 'super_admin');

-- ── 4. Drop SET search_path from the 5 RLS helper functions ────────────────
-- All five are LANGUAGE SQL, STABLE, SECURITY INVOKER, with no unqualified
-- table/type references (is_super_admin's one internal call is already
-- schema-qualified as public.app_current_role()) — the search_path pin buys
-- nothing and is exactly what blocks Postgres's SQL inliner, confirmed live:
-- a wrapped is_super_admin() call costs ~25x an inlined equivalent doing the
-- same comparison. CREATE OR REPLACE resets grants to default in this
-- Postgres version (a lesson this codebase has hit twice before on views/
-- functions) — re-GRANT EXECUTE explicitly afterward, matching what's live
-- today (anon, app_tenant, authenticated, postgres, service_role).
CREATE OR REPLACE FUNCTION public.app_current_group_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_group_id', true), '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.app_current_organization_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.app_current_role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_role', true), '');
$function$;

CREATE OR REPLACE FUNCTION public.app_current_user_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')::uuid;
$function$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT public.app_current_role() = 'super_admin';
$function$;

GRANT EXECUTE ON FUNCTION public.app_current_group_id() TO anon, app_tenant, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.app_current_organization_id() TO anon, app_tenant, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.app_current_role() TO anon, app_tenant, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO anon, app_tenant, authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO anon, app_tenant, authenticated, postgres, service_role;
