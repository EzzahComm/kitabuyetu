-- 190: audit_logs_insert was missing the organization_coordinator branch
--
-- audit_logs_insert's WITH CHECK only allowed group_id = app_current_group_id(),
-- but audit_logs_select (same table, migration 168/169) already allows
-- organization_coordinator to act at the organization level (group_id NULL,
-- organization_id set) via withOrganizationAccess. Since NULL = NULL is never
-- true in SQL, every organization-scoped audit write (e.g.
-- organization-finance.service.ts's capitalize/decapitalize) has been
-- rejected by RLS under app_tenant — surfaced by CI's "Test (tenant
-- isolation, real Postgres, under app_tenant)" phase running for real for the
-- first time (earlier fixes this session let CI get that far), but live in
-- production too: TENANT_DATABASE_URL enforces this same policy there.
DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;

CREATE POLICY audit_logs_insert ON audit_logs
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (
      app_current_role() = 'organization_coordinator'
      AND organization_id = app_current_organization_id()
    )
  );
