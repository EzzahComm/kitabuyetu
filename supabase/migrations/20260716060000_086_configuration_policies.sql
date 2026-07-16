-- Configuration Service / Policy Resolution Engine (ACCOUNTING_ARCHITECTURE_AUDIT.md
-- §29). Generalizes the one proven inheritance pattern already in the
-- codebase — lib/sms/trigger-engine.ts's group > organization > platform rule
-- resolution (specificity: group beats organization beats platform-wide
-- NULL/NULL) — into a single reusable table any policy domain can use, rather
-- than adding more flat columns to groups/organizations one migration at a
-- time (the pattern that produced the six uncoordinated overrides in §22).
--
-- First domain wired: ApprovalPolicy, unifying three independent flat
-- columns the audit's §25 Policy Inheritance & Override Matrix flagged as
-- broken today — groups.journal_approval_threshold,
-- groups.disbursement_approval_threshold, and
-- organizations.disbursement_approval_threshold — into one cascading,
-- versioned Platform -> Organization -> Group resolver. Deliberately NOT in
-- scope for this migration: the other 12 policy domains listed in §29.5
-- (LoanPolicy, SavingsPolicy, etc.), posting templates (§29.9), and Program-
-- level scoping (§29.2's optional tier) — those are follow-up rounds once
-- this first domain proves the engine.
--
-- Versioning (§29.8): rows are never updated in place. Setting a new value
-- retires the current active row (is_active=false, effective_to=NOW()) and
-- inserts a new one with version+1 — so historical transactions can always
-- be traced back to the policy version in force when they were created.

CREATE TABLE policies (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          TEXT          NOT NULL,
  policy_key      TEXT          NOT NULL,
  organization_id UUID          REFERENCES organizations (id) ON DELETE CASCADE,
  group_id        UUID          REFERENCES groups (id) ON DELETE CASCADE,
  value           JSONB         NOT NULL,
  version         INT           NOT NULL DEFAULT 1,
  effective_from  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  effective_to    TIMESTAMPTZ,
  is_active       BOOLEAN       NOT NULL DEFAULT true,
  created_by      UUID          REFERENCES members (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT policies_version_positive CHECK (version > 0)
);

-- At most one ACTIVE row per (domain, policy_key, scope) — a real UNIQUE
-- constraint would treat NULL organization_id/group_id as distinct every
-- time (standard SQL NULL semantics), so a sentinel via COALESCE collapses
-- "platform-wide" (both NULL) into one comparable value.
CREATE UNIQUE INDEX policies_active_scope_unique ON policies (
  domain, policy_key,
  COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'),
  COALESCE(group_id,        '00000000-0000-0000-0000-000000000000')
) WHERE is_active;

CREATE INDEX idx_policies_domain_key   ON policies (domain, policy_key);
CREATE INDEX idx_policies_organization ON policies (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_policies_group        ON policies (group_id)        WHERE group_id IS NOT NULL;

-- ─── RLS (§29.12: FORCE from the first migration) ───────────────────────────
--
-- SELECT visibility is deliberately broader than write visibility: a group
-- session must be able to see its organization's and the platform's rows
-- (that's the whole point of a cascade), not just rows it owns. Writes stay
-- scoped to exactly the tier the session belongs to.

ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies FORCE  ROW LEVEL SECURITY;

CREATE POLICY policies_select ON policies
  FOR SELECT USING (
    is_super_admin()
    OR (organization_id IS NULL AND group_id IS NULL)
    OR (group_id = app_current_group_id())
    OR (organization_id = app_current_organization_id())
    OR (group_id IS NULL AND organization_id IN (
          SELECT oga.organization_id FROM organization_group_access oga
          WHERE oga.group_id = app_current_group_id() AND oga.is_active
        ))
  );

CREATE POLICY policies_insert ON policies
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id() AND organization_id IS NULL)
    OR (organization_id = app_current_organization_id() AND group_id IS NULL AND app_current_role() = 'organization_coordinator')
  );

CREATE POLICY policies_update ON policies
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND organization_id IS NULL)
    OR (organization_id = app_current_organization_id() AND group_id IS NULL AND app_current_role() = 'organization_coordinator')
  );

-- ─── Seed: platform-wide ApprovalPolicy defaults ────────────────────────────
-- Set to the EXACT values the pre-existing flat columns already default to
-- (groups.journal_approval_threshold=0, groups.disbursement_approval_threshold=20000,
-- organizations.disbursement_approval_threshold=50000) so introducing the
-- cascade changes zero behavior for any existing group or organization —
-- every one of them is sitting at exactly these defaults today with no
-- overrides (verified before writing this migration).

INSERT INTO policies (domain, policy_key, value, version)
VALUES
  ('approval', 'journal_threshold',            '{"threshold": 0}'::jsonb,     1),
  ('approval', 'group_disbursement_threshold', '{"threshold": 20000}'::jsonb, 1),
  ('approval', 'org_disbursement_threshold',   '{"threshold": 50000}'::jsonb, 1);
