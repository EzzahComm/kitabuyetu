-- ─────────────────────────────────────────────────────────────────────────────
-- 168 — audit_logs: organization scope (R11 audit-on-read)
--
-- Two defects, one of them live today.
--
-- 1. audit_logs has no organization_id. An organization-level action (viewing
--    the portfolio, generating a portfolio report, exporting) is not tied to
--    any single group, so it can only be written with group_id = NULL — and a
--    NULL group_id is attributable to nobody.
--
-- 2. LIVE BUG: audit_logs_select (migration 010, never revised since) reads
--
--        is_super_admin() OR group_id = app_current_group_id()
--
--    An organization_coordinator holds a backoffice token with an organization
--    and NO group — withOrganizationAccess passes groupId '' precisely so that
--    app_current_group_id() returns NULL. `group_id = NULL` is never true, so
--    a coordinator can read NO audit rows at all, and
--    organizationService.listAuditLogs runs under withDb (RLS-enforced).
--    The /enterprise/audit page therefore renders empty rather than erroring,
--    which is why this has gone unnoticed.
--
--    Verified against a real Postgres before writing this migration: with
--    audit_logs holding one row, the owner (BYPASSRLS) saw 1 and app_tenant
--    with app.current_role='organization_coordinator' saw 0.
--
-- Fixing (1) without (2) would write audit rows nobody can read — a detector
-- with no reader. Both are therefore in this one migration.
--
-- audit_logs_insert is deliberately left alone: direct inserts stay blocked for
-- app roles, so audit writes continue to go through a privileged path.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL;

COMMENT ON COLUMN audit_logs.organization_id IS
  'Set for organization-axis actions (portfolio views, report generation, exports) which belong to an organization rather than to any one group. Group-scoped rows keep using group_id; a row may legitimately carry both.';

-- Mirrors idx_audit_logs_group_id: the audit viewer always orders by recency
-- within a scope, never scans the column alone.
CREATE INDEX IF NOT EXISTS idx_audit_logs_organization_id
  ON audit_logs (organization_id, created_at DESC);

-- ─── Reader: give the organization coordinator an arm ────────────────────────
-- Same shape as the coordinator arm already present on groups/contributions/
-- loans (see 122_consolidate_permissive_policies.sql): reachable either by the
-- organization directly, or through a group the organization actively links.
DROP POLICY IF EXISTS audit_logs_select ON audit_logs;

CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (
      app_current_role() = 'organization_coordinator'
      AND (
        organization_id = app_current_organization_id()
        OR group_id IN (
          SELECT group_id FROM organization_group_access
          WHERE organization_id = app_current_organization_id()
            AND is_active = true
        )
      )
    )
  );
