-- ─────────────────────────────────────────────────────────────────────────────
-- 206: Programs — organization-run initiatives groups apply to or are invited
--      into (recruitment/membership, NOT money). Core data model + RLS only;
--      UI, notifications, and program-team/activity tracking are a follow-up.
--
-- Two UNRELATED existing systems share the English word "program" — this
-- migration touches neither:
--   - funding_programs: a budget/disbursement config. Group "enrollment" is
--     DERIVED from organization_disbursements rows, never stored — see
--     organization-finance.service.ts's own comment: "a group belongs to a
--     programme because money actually moved to it." No group-facing UI, no
--     application/invitation workflow. Left completely untouched.
--   - `programs` (THIS migration replaces it): a dead, 0-row crowdfunding-
--     campaign table (target_amount/slug/cover_image/impact metrics), with
--     orphaned app code still pointing at it — app/(dashboard)/programs,
--     app/(admin)/admin/programs, app/api/admin/programs/* — one of which
--     even uses the wrong auth system (real Supabase Auth, not this app's
--     custom JWT), so it was already broken. The app code is deleted in this
--     PR; the table is dropped and recreated here with the real shape.
--
-- donations.program_id / its donation_source CHECK constraint referenced the
-- dead table (0 rows ever used it) under the premise "a donation can target
-- a program" — crowdfunding semantics that have nothing to do with THIS
-- Program concept (recruitment/membership, not fundraising), so the column
-- is dropped and the constraint simplified rather than repointed.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ Clean up the dead crowdfunding-shaped programs table ═══════════════════

ALTER TABLE donations DROP CONSTRAINT donation_source;
DROP INDEX IF EXISTS idx_donations_program;
ALTER TABLE donations DROP COLUMN program_id;
ALTER TABLE donations ADD CONSTRAINT donation_source CHECK (campaign_id IS NOT NULL);

DROP TABLE programs;

-- ═══ Real Programs domain ═════════════════════════════════════════════════

CREATE TYPE program_status AS ENUM ('draft', 'published', 'paused', 'closed', 'archived');

CREATE TABLE programs (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                     TEXT NOT NULL CHECK (length(trim(name)) >= 3),
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  objectives               TEXT,
  target_beneficiaries     TEXT,
  -- Descriptive, not programmatically evaluated — matches funding_programs'
  -- own eligibility_criteria jsonb, which is stored for display only too.
  eligibility_criteria     JSONB NOT NULL DEFAULT '{}'::jsonb,
  geographic_coverage      JSONB NOT NULL DEFAULT '[]'::jsonb,
  application_requirements TEXT,
  status                   program_status NOT NULL DEFAULT 'draft',
  starts_on                DATE,
  ends_on                  DATE,
  created_by               UUID NOT NULL REFERENCES members (id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_programs_organization ON programs (organization_id, created_at DESC);
CREATE INDEX idx_programs_status_published ON programs (status) WHERE status = 'published';

CREATE TRIGGER trg_programs_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TYPE program_application_status AS ENUM (
  'draft', 'submitted', 'under_review', 'additional_information_requested',
  'accepted', 'declined', 'withdrawn'
);

CREATE TABLE program_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  submitted_by    UUID NOT NULL REFERENCES members (id),
  status          program_application_status NOT NULL DEFAULT 'submitted',
  application_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_notes    TEXT,
  reviewed_by     UUID REFERENCES members (id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active (non-terminal) application per group per program at a time.
CREATE UNIQUE INDEX idx_program_applications_one_active
  ON program_applications (program_id, group_id)
  WHERE status NOT IN ('declined', 'withdrawn');

CREATE INDEX idx_program_applications_program ON program_applications (program_id, status);
CREATE INDEX idx_program_applications_group ON program_applications (group_id);

CREATE TRIGGER trg_program_applications_updated_at
  BEFORE UPDATE ON program_applications
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TYPE program_invitation_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled', 'expired');

CREATE TABLE program_invitations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id   UUID NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  group_id     UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  invited_by   UUID NOT NULL REFERENCES members (id),
  message      TEXT,
  status       program_invitation_status NOT NULL DEFAULT 'pending',
  expires_at   TIMESTAMPTZ,
  accepted_at  TIMESTAMPTZ,
  declined_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One pending invitation per group per program at a time.
CREATE UNIQUE INDEX idx_program_invitations_one_pending
  ON program_invitations (program_id, group_id)
  WHERE status = 'pending';

CREATE INDEX idx_program_invitations_program ON program_invitations (program_id, status);
CREATE INDEX idx_program_invitations_group ON program_invitations (group_id, status);

CREATE TRIGGER trg_program_invitations_updated_at
  BEFORE UPDATE ON program_invitations
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

CREATE TYPE program_membership_status AS ENUM ('invited', 'active', 'suspended', 'withdrawn', 'completed', 'removed');
CREATE TYPE program_membership_source AS ENUM ('application', 'invitation');

CREATE TABLE program_memberships (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id  UUID NOT NULL REFERENCES programs (id) ON DELETE CASCADE,
  group_id    UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  status      program_membership_status NOT NULL DEFAULT 'active',
  source      program_membership_source NOT NULL,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ,
  left_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One active-or-invited membership per group per program at a time.
CREATE UNIQUE INDEX idx_program_memberships_one_active
  ON program_memberships (program_id, group_id)
  WHERE status IN ('invited', 'active');

CREATE INDEX idx_program_memberships_program ON program_memberships (program_id, status);
CREATE INDEX idx_program_memberships_group ON program_memberships (group_id, status);

CREATE TRIGGER trg_program_memberships_updated_at
  BEFORE UPDATE ON program_memberships
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ═══ RLS ══════════════════════════════════════════════════════════════════
-- Shape mirrors organization_group_access's corrected policies from the
-- group-org-link-requests migration (206 on the sibling branch) — org
-- coordinator for their own org's rows, group chairperson for their own
-- group's rows, super_admin for all. Every write here goes through
-- withAdminDb in the service layer (same as that feature), so these are the
-- real backstop, not the only check.

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs FORCE ROW LEVEL SECURITY;

-- Published programs are visible to any group (discovery); draft/paused/
-- closed/archived are owner-only. super_admin sees everything.
CREATE POLICY programs_select ON programs
  FOR SELECT USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator' AND organization_id = app_current_organization_id())
    OR (status = 'published' AND app_current_role() IN ('chairperson', 'secretary', 'treasurer', 'member'))
  );

CREATE POLICY programs_write ON programs
  FOR ALL USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator' AND organization_id = app_current_organization_id())
  )
  WITH CHECK (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator' AND organization_id = app_current_organization_id())
  );

GRANT ALL ON programs TO service_role;

ALTER TABLE program_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_applications FORCE ROW LEVEL SECURITY;

CREATE POLICY program_applications_select ON program_applications
  FOR SELECT USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'secretary', 'treasurer', 'member'))
    OR (app_current_role() = 'organization_coordinator'
        AND program_id IN (SELECT id FROM programs WHERE organization_id = app_current_organization_id()))
  );

-- INSERT: only the group side (submitting an application). UPDATE: only the
-- org side (review decisions) or the group side withdrawing its own.
CREATE POLICY program_applications_insert ON program_applications
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
  );

CREATE POLICY program_applications_update ON program_applications
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
    OR (app_current_role() = 'organization_coordinator'
        AND program_id IN (SELECT id FROM programs WHERE organization_id = app_current_organization_id()))
  );

GRANT ALL ON program_applications TO service_role;

ALTER TABLE program_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_invitations FORCE ROW LEVEL SECURITY;

CREATE POLICY program_invitations_select ON program_invitations
  FOR SELECT USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'secretary', 'treasurer', 'member'))
    OR (app_current_role() = 'organization_coordinator'
        AND program_id IN (SELECT id FROM programs WHERE organization_id = app_current_organization_id()))
  );

-- INSERT/cancel: only the org side. UPDATE (accept/decline): only the group side.
CREATE POLICY program_invitations_insert ON program_invitations
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND program_id IN (SELECT id FROM programs WHERE organization_id = app_current_organization_id()))
  );

CREATE POLICY program_invitations_update ON program_invitations
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
    OR (app_current_role() = 'organization_coordinator'
        AND program_id IN (SELECT id FROM programs WHERE organization_id = app_current_organization_id()))
  );

GRANT ALL ON program_invitations TO service_role;

ALTER TABLE program_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_memberships FORCE ROW LEVEL SECURITY;

CREATE POLICY program_memberships_select ON program_memberships
  FOR SELECT USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() IN ('chairperson', 'secretary', 'treasurer', 'member'))
    OR (app_current_role() = 'organization_coordinator'
        AND program_id IN (SELECT id FROM programs WHERE organization_id = app_current_organization_id()))
  );

-- Every write here goes through the application/invitation acceptance flow
-- in withAdminDb — no direct tenant-role write path is needed, so this is
-- intentionally admin-only, same shape as organization_group_access_update.
CREATE POLICY program_memberships_write ON program_memberships
  FOR ALL USING (is_super_admin())
  WITH CHECK (is_super_admin());

GRANT ALL ON program_memberships TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT ON programs TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON program_applications TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON program_invitations TO app_tenant';
    EXECUTE 'GRANT SELECT ON program_memberships TO app_tenant';
  END IF;
END $do$;
