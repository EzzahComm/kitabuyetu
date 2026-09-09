-- ─────────────────────────────────────────────────────────────────────────────
-- 114: fix audit_logs' INSERT policy — it silently blocked every manual
-- application-level audit write under real RLS enforcement
--
-- Found by the app_tenant CI job (ADR-001), which is the only place this
-- codebase's tests actually run under RLS rather than the app's normal
-- BYPASSRLS role — invisible in production today for the same reason.
--
-- Migration 010 gave audit_logs a single INSERT policy:
--   CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT WITH CHECK (is_super_admin());
-- with the stated intent that all writes go through the automatic
-- SECURITY DEFINER trigger (private.audit_sensitive_change(), migration 017),
-- which is exempt from RLS entirely regardless of this policy. That was true
-- for members/loans/contributions-style automatic audit rows — but at least
-- 9 services (credit-scores, import, loans' markDefaulted/writeOff,
-- accounting, dividends, fiscal-periods, member-roles, shares, whatsapp) also
-- do a manual `INSERT INTO audit_logs` directly from application code, always
-- as the CALLING tenant role (chairperson/treasurer/secretary/member), never
-- super_admin. Every one of those inserts has been rejected with 42501 under
-- real RLS since the day this policy was written; only BYPASSRLS in
-- production and in every prior local/CI test run masked it.
--
-- Fix: let a tenant role insert an audit row scoped to their OWN group,
-- mirroring audit_logs_select's existing group_id = app_current_group_id()
-- shape exactly — the app layer already computes group_id/actor_id from a
-- verified JWT, so this is the same defense-in-depth trust model every other
-- tenant-write table already uses, not a weakening.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER POLICY audit_logs_insert ON public.audit_logs
  WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
  );
