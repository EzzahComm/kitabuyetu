-- ─────────────────────────────────────────────────────────────────────────────
-- 153: organizations UPDATE policy never granted organization_coordinator
--
-- organizations_update (renamed from ngos_update by migration 050, but the
-- USING clause itself predates that rename) has always been
-- `USING (is_super_admin())` — super_admin only. organizationService.
-- setBranding() lets an organization_coordinator update their OWN org's
-- logo_url/primary_color under withDb(ctx, ...) — real app_tenant RLS, not
-- the admin pool — and has done so since white-label branding shipped. That
-- write was silently a no-op RLS filtered every row, not a hard error: the
-- UPDATE ran, matched zero rows, and setBranding's own
-- `if (!rows[0]) throw new NotFoundError(...)` fired, misreporting "the
-- organization doesn't exist" for an organization that plainly does.
--
-- This went unnoticed because nothing had exercised setBranding() under the
-- real app_tenant role before: migration 152's organization-plans test suite
-- is the first real coverage of the white-label feature end to end, and it
-- surfaced this the moment it ran under CI's "under app_tenant" pass (the
-- admin-pool / RLS-bypassed pass never would have caught it).
--
-- Mirrors organizations_select's existing shape exactly — a coordinator may
-- act only on their own organization, never another's.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER POLICY organizations_update ON organizations
  USING (
    is_super_admin()
    OR (
      app_current_role() = 'organization_coordinator'
      AND id = app_current_organization_id()
    )
  );
