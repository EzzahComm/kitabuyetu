-- =============================================================================
-- 132: Consolidate feature_flags' RLS policies to a stable, non-redundant pair
--
-- DB_PERFORMANCE_ADVISOR_AUDIT_2026-08.md's F1 Phase 2 already found
-- feature_flags carrying 3 live policies (feature_flags_read,
-- feature_flags_tenant_read — byte-identical SELECT-true conditions, a
-- redundant duplicate — plus feature_flags_write) against only 2 in
-- migration history (super_admin_feature_flags, feature_flags_tenant_read
-- from migration 097); feature_flags_write is a live rename of
-- super_admin_feature_flags never captured in a migration. Deliberately
-- deferred at the time ("Not attempted in this pass"), re-confirmed still
-- true and unchanged by PRODUCTION_READINESS_AUDIT Pass 2.
--
-- This migration must work whether the target is a fresh build (2 policies,
-- migration-history names) or production (3 policies, drifted names) — drop
-- every known name variant unconditionally, then recreate exactly the 2
-- non-redundant policies both should end up with. Idempotent regardless of
-- starting state.
-- =============================================================================

DROP POLICY IF EXISTS feature_flags_read        ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_tenant_read  ON public.feature_flags;
DROP POLICY IF EXISTS feature_flags_write        ON public.feature_flags;
DROP POLICY IF EXISTS super_admin_feature_flags  ON public.feature_flags;

CREATE POLICY feature_flags_read ON public.feature_flags
  FOR SELECT USING (true);

CREATE POLICY feature_flags_write ON public.feature_flags
  FOR ALL USING (current_setting('app.current_role', true) = 'super_admin');
