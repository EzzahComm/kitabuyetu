-- ============================================================================
-- 169 — Organization coordinators can read the group-scoped tables their
--        portfolio is built from.
--
-- THE BUG
-- An organization coordinator holds no group. withOrganizationAccess passes
-- groupId as an empty-string sentinel, app_current_group_id() is
-- NULLIF(current_setting('app.current_group_id', true), '')::uuid, and so
-- returns NULL. Every policy on the tables below was:
--
--     is_super_admin() OR group_id = app_current_group_id()
--
-- `group_id = NULL` is NULL, not false, so no row qualified and the tables were
-- entirely invisible to a coordinator. Because the whole organization read
-- surface goes through withDb (the app_tenant pool, RLS enforced — only
-- settleOrgDisbursement uses withAdminDb), the enterprise portal has been
-- reading zeros and empty lists rather than erroring.
--
-- Observed symptoms, all of them silent:
--   * getDashboard         — active_members and loans_repaid read 0
--   * listGroupSummaries   — member counts 0; plan reads as "no plan" because
--                            the subscriptions LEFT JOIN LATERAL matched nothing
--   * getGroupDetail       — same, per group
--   * listMembers          — empty list
--   * getMemberDetail      — 404, because an invisible membership is
--                            indistinguishable from a missing one
--
-- This is the same class of defect as migration 168 (audit_logs excluded
-- coordinators from its SELECT policy, so /enterprise/audit returned zero rows
-- for every coordinator). 168 fixed one table; this fixes the rest of the
-- surface. loans, contributions, groups, funding_programs and the
-- organization_* tables already carry the arm — that inconsistency is why the
-- portal looked partly functional.
--
-- WHY ADDITIVE POLICIES, NOT DROP + CREATE
-- Permissive policies OR together, so a separate FOR SELECT policy grants
-- exactly the new read and nothing else. It matters most for subscriptions,
-- which carries a single FOR ALL policy: widening that expression in place
-- would have handed coordinators INSERT/UPDATE/DELETE on subscriptions as a
-- side effect. Keeping each change additive also means a revert is four DROP
-- POLICY statements, and no existing arm is re-transcribed by hand.
--
-- SCOPE
-- Read-only, and only through an ACTIVE organization_group_access row. A
-- deactivated link revokes visibility immediately. Gated on app_current_role()
-- = 'organization_coordinator'; proxy.ts strips all claim headers from every
-- inbound request and re-stamps them only from an HS256-verified JWT, so the
-- role cannot be forged by a client.
--
-- `accounts` is deliberately NOT included. It is read only inside
-- settleOrgDisbursement, which uses withAdminDb and therefore bypasses RLS.
-- Adding an arm there would widen access with no read to justify it.
--
-- Proof: __tests__/integration/app-tenant/rls-organization-coordinator-reads.test.ts
-- These assertions are meaningless against the BYPASSRLS admin pool, which is
-- how the gap survived — the ordinary integration suite was 482/482 green while
-- the app_tenant run failed. They run under
-- jest.integration.app-tenant.config.ts only.
-- ============================================================================

-- ── group_members ──────────────────────────────────────────────────────────
-- The table behind every member count in the portfolio.
DROP POLICY IF EXISTS group_members_org_coordinator_select ON group_members;
CREATE POLICY group_members_org_coordinator_select ON group_members
  FOR SELECT USING (
    (SELECT app_current_role()) = 'organization_coordinator'
    AND group_id IN (
      SELECT oga.group_id FROM organization_group_access oga
      WHERE oga.organization_id = (SELECT app_current_organization_id())
        AND oga.is_active = true
    )
  );

-- ── loan_repayments ────────────────────────────────────────────────────────
-- getDashboard's loans_repaid aggregate. Read 0 for every coordinator.
DROP POLICY IF EXISTS loan_repayments_org_coordinator_select ON loan_repayments;
CREATE POLICY loan_repayments_org_coordinator_select ON loan_repayments
  FOR SELECT USING (
    (SELECT app_current_role()) = 'organization_coordinator'
    AND group_id IN (
      SELECT oga.group_id FROM organization_group_access oga
      WHERE oga.organization_id = (SELECT app_current_organization_id())
        AND oga.is_active = true
    )
  );

-- ── subscriptions ──────────────────────────────────────────────────────────
-- Read via LEFT JOIN LATERAL in listGroupSummaries/getGroupDetail, so an
-- invisible row degraded to "no plan" instead of failing loudly.
-- FOR SELECT only: subscriptions_all stays untouched, writes stay shut.
DROP POLICY IF EXISTS subscriptions_org_coordinator_select ON subscriptions;
CREATE POLICY subscriptions_org_coordinator_select ON subscriptions
  FOR SELECT USING (
    (SELECT app_current_role()) = 'organization_coordinator'
    AND group_id IN (
      SELECT oga.group_id FROM organization_group_access oga
      WHERE oga.organization_id = (SELECT app_current_organization_id())
        AND oga.is_active = true
    )
  );

-- ── members ────────────────────────────────────────────────────────────────
-- members has no group_id, so the arm reaches it through the membership.
--
-- Deliberately does NOT filter gm.is_active, unlike the existing group arm: a
-- coordinator must be able to resolve a member whose membership has been
-- deactivated, or portfolio health reports 0 inactive members — the exact
-- assertion portfolio-health.test.ts failed on. Membership in a linked group,
-- current or lapsed, is the grant; activity is a reporting dimension, not a
-- visibility boundary.
--
-- national_id is NOT protected by this policy — it is column data on a row the
-- coordinator can now read. getMemberDetail omits it in the service layer for
-- that reason (audit_logs cites member.view_pii as a distinct action). Any new
-- reader of members on the organization axis must make the same choice
-- explicitly; the policy will not make it for them.
DROP POLICY IF EXISTS members_org_coordinator_select ON members;
CREATE POLICY members_org_coordinator_select ON members
  FOR SELECT USING (
    (SELECT app_current_role()) = 'organization_coordinator'
    AND id IN (
      SELECT gm.member_id
      FROM group_members gm
      JOIN organization_group_access oga ON oga.group_id = gm.group_id
      WHERE oga.organization_id = (SELECT app_current_organization_id())
        AND oga.is_active = true
    )
  );

COMMENT ON POLICY group_members_org_coordinator_select ON group_members IS
  'Migration 169: organization coordinators read memberships of actively linked groups. Read-only; revoked with the link.';
COMMENT ON POLICY loan_repayments_org_coordinator_select ON loan_repayments IS
  'Migration 169: organization coordinators read repayments of actively linked groups. Read-only; revoked with the link.';
COMMENT ON POLICY subscriptions_org_coordinator_select ON subscriptions IS
  'Migration 169: organization coordinators read subscriptions of actively linked groups. SELECT only — subscriptions_all still governs writes.';
COMMENT ON POLICY members_org_coordinator_select ON members IS
  'Migration 169: organization coordinators read members of actively linked groups, active or not. Does not gate national_id — callers must omit PII explicitly.';
