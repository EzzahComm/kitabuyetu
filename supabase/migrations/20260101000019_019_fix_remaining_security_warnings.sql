-- =============================================================================
-- 019_fix_remaining_security_warnings.sql
--
-- Fixes the 3 Security Advisor warnings that appeared after migration 018:
--
--   1. RLS Enabled No Policy — public.invoice_sequences
--      Supabase re-enables RLS on tables in the public schema after each push,
--      overriding our DISABLE statements from migrations 009 and 016.
--      Fix: DISABLE again (idempotent) + revoke all from anon/authenticated.
--
--   2. Public  Can Execute SECURITY DEFINER Function — public.rls_auto_enable()
--   3. Signed-In Can Execute SECURITY DEFINER Function — public.rls_auto_enable()
--
--      rls_auto_enable() is a Supabase-internal utility function created by
--      the platform/CLI. As SECURITY DEFINER it runs with superuser-equivalent
--      privileges. If anon or authenticated callers can reach it via
--      /rest/v1/rpc/rls_auto_enable, they could enable RLS on tables that have
--      no policies, locking every user out of those tables (data-access DoS).
--
--      Permanent fix: switch to SECURITY INVOKER. Anon has no ALTER TABLE
--      privilege, so even if Supabase re-grants EXECUTE after the next push,
--      the function fails harmlessly for unprivileged callers.
--      belt-and-suspenders: REVOKE EXECUTE from anon/authenticated.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- FIX 1: invoice_sequences — disable RLS (no policy needed; no user data)
-- ---------------------------------------------------------------------------

-- Supabase re-enables RLS on public tables after each `db push`. This table is
-- an internal sequencing counter (no group_id / user data). RLS is semantically
-- meaningless here and, without policies, causes default-deny that breaks
-- next_invoice_number(). Keep it explicitly OFF.
ALTER TABLE public.invoice_sequences DISABLE ROW LEVEL SECURITY;

-- Belt-and-suspenders: ensure anon/authenticated still have no DML access
-- (applied in migration 018; repeated here to survive any re-grant between pushes)
REVOKE SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.invoice_sequences
  FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE
  ON TABLE public.invoice_sequences
  TO service_role;


-- ---------------------------------------------------------------------------
-- FIX 2 & 3: rls_auto_enable() — switch from SECURITY DEFINER to INVOKER
--
-- SECURITY INVOKER makes the function execute under the CALLER's privileges
-- instead of the owner's (superuser) privileges.
--
-- Result:
--   • anon calling it → runs as anon → no ALTER TABLE privilege → fails safely
--   • authenticated calling it → runs as authenticated → fails safely
--   • postgres / service_role calling it internally → still works (they have
--     the required privileges directly)
--
-- This change persists in pg_proc. It survives future `supabase db push` runs
-- UNLESS Supabase recreates the function from its own internal template
-- (in which case this migration would need to be re-applied via SQL Editor).
-- ---------------------------------------------------------------------------
-- rls_auto_enable() only exists on real Supabase-provisioned projects (it's
-- part of their platform template, not something any migration here
-- creates) — every statement touching it, including the belt-and-suspenders
-- REVOKE/GRANT below, must stay inside this same guard so applying these
-- migrations to a plain Postgres instance (local dev, CI) doesn't fail on a
-- function that was never expected to exist there.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    ALTER FUNCTION public.rls_auto_enable() SECURITY INVOKER;

    -- Belt-and-suspenders REVOKE (Supabase re-grants EXECUTE on all public
    -- functions after each push, so this is a session-scoped defence. The
    -- SECURITY INVOKER change above is the durable fix.)
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated, public;
    GRANT  EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role, postgres;
  END IF;
END;
$$;
