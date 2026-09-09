-- =============================================================================
-- 097_force_rls_on_tenant_path_tables.sql
--
-- Prep step for a future non-BYPASSRLS `app_tenant` role (see 058's comment:
-- "kept for a future non-BYPASSRLS tenant role"). Since no migration has ever
-- run ALTER TABLE ... OWNER TO, the connecting role is every table's owner —
-- and non-FORCE RLS never applies to the owner, bypass or not. These 12
-- tables are the ones actually queried via lib/db's withDb()/withTransaction()
-- (i.e. real tenant-context calls, not withAdminDb's system/admin path):
-- feature_flags, group_contribution_splits, investments, investment_returns,
-- meetings, meeting_attendance, meeting_resolutions, mpesa_unrouted,
-- sms_group_settings, sms_templates, welfare_requests,
-- welfare_pool_contributions.
--
-- Verified directly (not just via the earlier audit grep, which missed
-- policies created inside `EXECUTE format(...)` loops): 11 of these 12
-- already have a correct, complete FOR ALL group_id-scoped policy — they only
-- need FORCE. `feature_flags` has no group_id column (it's genuine global
-- config) and its only existing policy restricts ALL commands to
-- super_admin — that would block the ordinary tenant read path
-- (feature-flags.service.ts's isFeatureEnabled(), called via withDb from
-- normal member requests) the moment FORCE takes effect for a non-bypass
-- role, so it gets an additional SELECT-for-everyone policy first, mirroring
-- the existing `rls_charge_tiers_read` precedent for other global read-only
-- reference data (migration 047).
--
-- withAdminDb's callers (admin dashboards, cron/job workers, webhooks) are
-- unaffected by FORCE: they continue running on the existing BYPASSRLS role,
-- and BYPASSRLS overrides FORCE regardless (Postgres: a role with BYPASSRLS
-- ignores row security entirely, FORCE or not).
-- =============================================================================

-- feature_flags has no group_id column — it's global config. Only
-- "super_admin_feature_flags" (FOR ALL, super_admin-only) exists today; add a
-- read policy for ordinary tenant sessions before forcing RLS on this table.
CREATE POLICY feature_flags_tenant_read ON public.feature_flags
  FOR SELECT USING (true);

ALTER TABLE public.feature_flags               FORCE ROW LEVEL SECURITY;
ALTER TABLE public.group_contribution_splits    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.investments                  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.investment_returns           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meetings                     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_resolutions          FORCE ROW LEVEL SECURITY;
ALTER TABLE public.mpesa_unrouted               FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sms_group_settings           FORCE ROW LEVEL SECURITY;
ALTER TABLE public.sms_templates                FORCE ROW LEVEL SECURITY;
ALTER TABLE public.welfare_requests             FORCE ROW LEVEL SECURITY;
ALTER TABLE public.welfare_pool_contributions   FORCE ROW LEVEL SECURITY;
