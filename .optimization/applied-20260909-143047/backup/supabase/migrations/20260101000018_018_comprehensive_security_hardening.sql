-- =============================================================================
-- 018_comprehensive_security_hardening.sql
--
-- Comprehensive security hardening addressing all three Supabase Security
-- Advisor warning classes, plus additional defence-in-depth measures.
--
-- WARNING CLASSES ADDRESSED
-- ─────────────────────────
-- 1. Function Search Path Mutable
--    → Already fixed in 016/017. This migration verifies and extends coverage.
--
-- 2. Public Can Execute SECURITY DEFINER Function
--    → Trigger functions moved to private schema in 017 (permanent fix).
--    → next_invoice_number() SECURITY DEFINER removed here (permanent fix).
--    → Backend-only functions wrapped in private and restricted.
--
-- 3. RLS Enabled No Policy
--    → refresh_tokens: RLS enabled + owner-scoped policy added.
--
-- ADDITIONAL HARDENING
-- ────────────────────
-- • Schema-level lockdown (REVOKE CREATE ON SCHEMA public FROM PUBLIC)
-- • Sequence access restrictions (receipt_number_seq, invoice_sequences)
-- • members_insert policy tightened — removes the blanket OR true
-- • Cron-only functions moved to private schema
-- • Audit detection queries provided (run in Supabase SQL Editor)
--
-- ⚠ SUPABASE RE-GRANT CAVEAT
-- Supabase runs "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon,
-- authenticated" after every `supabase db push`. REVOKE statements in this
-- file are applied correctly on the first push but will be overwritten on
-- subsequent pushes of ANY migration.
-- Permanent solution for trigger functions: private schema (migration 017).
-- Permanent solution for callable functions: restrict at table/sequence level
-- (done below) rather than relying on EXECUTE grants.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- SECTION 1: SCHEMA-LEVEL LOCKDOWN
-- Revokes the ability to CREATE objects in the public schema from unprivileged
-- roles. This does not affect existing objects or USAGE on the schema.
-- Standard PostgreSQL 15+ hardening (Supabase re-grants USAGE, not CREATE).
-- ---------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC;


-- ---------------------------------------------------------------------------
-- SECTION 2: FIX invoice_sequences TABLE ACCESS
--
-- Root cause: invoice_sequences has RLS disabled. Without RLS, table-level
-- privileges are the sole access control layer. Supabase grants INSERT/UPDATE
-- to anon/authenticated by default, so any unauthenticated caller can call
-- next_invoice_number() and exhaust the monthly counter.
--
-- Fix:
--   a) Revoke DML on the table from anon/authenticated.
--   b) Grant only to service_role (the backend uses service_role).
--   c) Recreate next_invoice_number() WITHOUT SECURITY DEFINER — the DEFINER
--      was only needed so the function could bypass table privileges; now the
--      caller (service_role) already has those privileges directly.
--
-- After this change, anon cannot call next_invoice_number() because they
-- lack INSERT/UPDATE on invoice_sequences (the function fails at table access,
-- even though EXECUTE on the function is still granted by Supabase).
-- ---------------------------------------------------------------------------
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.invoice_sequences
  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.invoice_sequences
  TO service_role;

-- Recreate without SECURITY DEFINER — no SD warning, no anon exploitation
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS VARCHAR(50) LANGUAGE plpgsql
SET search_path = public AS $$
DECLARE
  v_ym  CHAR(6) := TO_CHAR(NOW(), 'YYYYMM');
  v_seq INTEGER;
BEGIN
  INSERT INTO public.invoice_sequences (year_month, last_seq)
  VALUES (v_ym, 1)
  ON CONFLICT (year_month) DO UPDATE
    SET last_seq = public.invoice_sequences.last_seq + 1
  RETURNING last_seq INTO v_seq;

  RETURN 'KY-' || v_ym || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;


-- ---------------------------------------------------------------------------
-- SECTION 3: FIX receipt_number_seq ACCESS
--
-- Root cause: Supabase grants USAGE on all sequences to anon/authenticated,
-- so anon can call nextval('receipt_number_seq') and waste sequence numbers.
-- next_receipt_number() is a SQL function that wraps nextval() — any caller
-- with EXECUTE on the function can exhaust the receipt counter.
--
-- Fix: Revoke USAGE on the sequence from anon/authenticated. This prevents
-- both direct nextval() calls and indirect calls via next_receipt_number().
-- Backend uses service_role which retains USAGE.
-- ---------------------------------------------------------------------------
REVOKE USAGE, SELECT ON SEQUENCE public.receipt_number_seq
  FROM anon, authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.receipt_number_seq
  TO service_role;


-- ---------------------------------------------------------------------------
-- SECTION 4: RLS ON refresh_tokens
--
-- Root cause: refresh_tokens was intentionally left without RLS because it is
-- accessed exclusively by the backend API using service_role. However, if an
-- attacker obtains an authenticated session (valid JWT), they could enumerate
-- all refresh tokens via the Supabase REST API.
--
-- Fix: Enable RLS + add an owner-scoped policy. service_role has BYPASSRLS
-- so backend operations are completely unaffected. The policy only restricts
-- direct authenticated calls via PostgREST.
-- ---------------------------------------------------------------------------
ALTER TABLE public.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refresh_tokens FORCE  ROW LEVEL SECURITY;

-- A member may only see/manage their own refresh tokens
CREATE POLICY refresh_tokens_owner ON public.refresh_tokens
  FOR ALL
  USING  (member_id = public.app_current_user_id())
  WITH CHECK (member_id = public.app_current_user_id());


-- ---------------------------------------------------------------------------
-- SECTION 5: TIGHTEN members_insert POLICY
--
-- Root cause: the original policy contains OR true, which allows ANY caller —
-- including anon — to INSERT into the members table directly via the Supabase
-- REST API, bypassing all application-layer validation (phone format, password
-- strength, duplicate checks, rate limiting, etc.).
--
-- Why it was written that way: member registration is handled by the backend
-- API (Node.js), which uses service_role. service_role bypasses RLS entirely,
-- so the policy doesn't restrict it at all. The OR true was a shortcut that
-- unintentionally opened a direct-insert hole for anon callers.
--
-- Fix: Replace OR true with a check that app.current_role has been set.
-- The backend middleware always sets SET LOCAL app.current_role before any DB
-- operation, so legitimate API traffic passes. Raw anon calls to PostgREST
-- that skip the middleware have no session variable set and are blocked.
-- service_role (backend registration) bypasses RLS and is always allowed.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS members_insert ON public.members;

CREATE POLICY members_insert ON public.members
  FOR INSERT WITH CHECK (
    public.is_super_admin()
    -- Require that the backend middleware has set the session role.
    -- Registration via API: backend uses service_role (bypasses RLS).
    -- Direct PostgREST calls without middleware: blocked.
    OR public.app_current_role() IS NOT NULL
  );


-- ---------------------------------------------------------------------------
-- SECTION 6: MOVE BACKEND-ONLY FUNCTIONS TO private SCHEMA
--
-- mark_overdue_repayments() and get_expired_subscriptions() are cron/scheduler
-- functions — they are NEVER called by end users, only by the backend scheduler.
-- Keeping them in public exposes them via /rest/v1/rpc/, allowing anon to
-- attempt execution (RLS protects the underlying tables, but exposure is still
-- a security smell and an unnecessary attack surface).
--
-- Pattern used:
--   private.fn()  — implementation; not exposed by PostgREST
--   public.fn()   — SECURITY DEFINER wrapper; restricts to service_role
--
-- The wrapper is SECURITY DEFINER so it can call private schema functions.
-- REVOKE from anon/authenticated means even though Supabase re-grants EXECUTE
-- on the wrapper after each push, the restriction is reapplied by this
-- migration (which only runs once; subsequent pushes re-grant, see caveat).
-- For a durable fix: remove the public wrappers and call private.fn()
-- directly via a postgres connection in the backend scheduler.
-- ---------------------------------------------------------------------------

-- ── private.mark_overdue_repayments() ────────────────────────────────────
CREATE OR REPLACE FUNCTION private.mark_overdue_repayments()
RETURNS INTEGER LANGUAGE plpgsql SET search_path = private, public AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH updated AS (
    UPDATE public.loan_repayments
    SET    status = 'overdue'
    WHERE  status = 'pending'
      AND  due_date < CURRENT_DATE
    RETURNING id
  )
  SELECT COUNT(*) INTO v_count FROM updated;

  WITH updated2 AS (
    UPDATE public.contributions
    SET    status = 'overdue'
    WHERE  status = 'pending'
      AND  due_date < CURRENT_DATE
    RETURNING id
  )
  SELECT v_count + COUNT(*) INTO v_count FROM updated2;

  RETURN v_count;
END;
$$;

-- Public wrapper — backward-compatible for existing supabase.rpc() calls
-- Replace with direct private.mark_overdue_repayments() call if using pg client
CREATE OR REPLACE FUNCTION public.mark_overdue_repayments()
RETURNS INTEGER LANGUAGE sql
SECURITY DEFINER SET search_path = public AS $$
  SELECT private.mark_overdue_repayments();
$$;

REVOKE EXECUTE ON FUNCTION public.mark_overdue_repayments()
  FROM anon, authenticated, public;
GRANT  EXECUTE ON FUNCTION public.mark_overdue_repayments()
  TO service_role;


-- ── private.get_expired_subscriptions() ──────────────────────────────────
CREATE OR REPLACE FUNCTION private.get_expired_subscriptions()
RETURNS TABLE(group_id UUID, plan_type public.plan_type, expired_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = private, public AS $$
  SELECT
    s.group_id,
    s.plan_type,
    s.expires_at
  FROM public.subscriptions s
  WHERE s.status      = 'active'
    AND s.expires_at  IS NOT NULL
    AND s.expires_at  < NOW() - (s.grace_period_days || ' days')::INTERVAL;
$$;

-- Public wrapper
CREATE OR REPLACE FUNCTION public.get_expired_subscriptions()
RETURNS TABLE(group_id UUID, plan_type public.plan_type, expired_at TIMESTAMPTZ)
LANGUAGE sql STABLE
SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM private.get_expired_subscriptions();
$$;

REVOKE EXECUTE ON FUNCTION public.get_expired_subscriptions()
  FROM anon, authenticated, public;
GRANT  EXECUTE ON FUNCTION public.get_expired_subscriptions()
  TO service_role;


-- ---------------------------------------------------------------------------
-- SECTION 7: REVOKE EXECUTE ON REMAINING SENSITIVE PUBLIC FUNCTIONS
--
-- These functions are SECURITY INVOKER, so anon is already blocked by RLS on
-- the underlying tables. The REVOKEs below formalise least-privilege intent.
--
-- ⚠ Re-grant caveat applies (see file header). For a durable solution,
-- move these functions to private schema and call via postgres connection.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.deduct_sms_credits(UUID, NUMERIC)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.generate_loan_schedule(UUID)
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number()
  FROM anon;
REVOKE EXECUTE ON FUNCTION public.next_receipt_number()
  FROM anon;

GRANT EXECUTE ON FUNCTION public.deduct_sms_credits(UUID, NUMERIC)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_loan_schedule(UUID)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.next_receipt_number()
  TO service_role;


-- ---------------------------------------------------------------------------
-- SECTION 8: RUNTIME AUDIT QUERIES
--
-- Run these in the Supabase SQL Editor at any time to detect regressions.
-- They are plain SELECT statements — safe to run on production.
-- ---------------------------------------------------------------------------

-- ── A. Tables with RLS enabled but ZERO policies ──────────────────────────
-- Expected result: 0 rows after this migration.
--
-- SELECT
--   schemaname,
--   tablename
-- FROM pg_tables t
-- WHERE schemaname = 'public'
--   AND rowsecurity = true
--   AND NOT EXISTS (
--     SELECT 1
--     FROM   pg_policies p
--     WHERE  p.schemaname = t.schemaname
--       AND  p.tablename  = t.tablename
--   )
-- ORDER BY tablename;


-- ── B. public-schema functions with mutable search_path ───────────────────
-- Expected result: 0 rows after migrations 016/017/018.
--
-- SELECT
--   p.proname                           AS function_name,
--   CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER'
--                    ELSE 'SECURITY INVOKER' END AS security_type,
--   p.proconfig                         AS config
-- FROM   pg_proc     p
-- JOIN   pg_namespace n ON n.oid = p.pronamespace
-- WHERE  n.nspname = 'public'
--   AND  NOT EXISTS (
--     SELECT 1
--     FROM   unnest(p.proconfig) cfg
--     WHERE  cfg LIKE 'search_path=%'
--   )
-- ORDER BY function_name;


-- ── C. SECURITY DEFINER functions in public schema callable by anon ────────
-- Expected result: 0 rows after this migration (trigger fns are in private).
--
-- SELECT
--   p.proname AS function_name,
--   has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
-- FROM   pg_proc     p
-- JOIN   pg_namespace n ON n.oid = p.pronamespace
-- WHERE  n.nspname   = 'public'
--   AND  p.prosecdef  = true
--   AND  has_function_privilege('anon', p.oid, 'EXECUTE') = true
-- ORDER BY function_name;


-- ── D. All SECURITY DEFINER functions (for manual review) ─────────────────
--
-- SELECT
--   n.nspname   AS schema,
--   p.proname   AS function_name,
--   r.rolname   AS owner
-- FROM   pg_proc       p
-- JOIN   pg_namespace  n ON n.oid = p.pronamespace
-- JOIN   pg_roles      r ON r.oid = p.proowner
-- WHERE  p.prosecdef = true
--   AND  n.nspname IN ('public', 'private')
-- ORDER BY n.nspname, p.proname;


-- ── E. Tables missing FORCE ROW LEVEL SECURITY (should be empty) ──────────
--
-- SELECT
--   schemaname,
--   tablename
-- FROM pg_tables t
-- WHERE schemaname = 'public'
--   AND rowsecurity   = true
--   AND NOT EXISTS (
--     SELECT 1
--     FROM   pg_class  c
--     JOIN   pg_namespace ns ON ns.oid = c.relnamespace
--     WHERE  ns.nspname = t.schemaname
--       AND  c.relname  = t.tablename
--       AND  c.relforcerowsecurity = true
--   )
-- ORDER BY tablename;
