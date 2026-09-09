-- =============================================================================
-- 017_member_onboarding_extensions.sql
-- Phase E1 of the Member Onboarding refactor.
--
-- Additive only:
--   • Extend members with new personal/profile fields (§2 of the spec)
--   • Extend group_members lifecycle with blacklisted/exited/archived statuses
--     and archival metadata (§2 status & lifecycle)
--   • New next_of_kin table with priority-based ordering (§3)
--   • Government-registration fields on groups (§4 conditional logic)
--
-- No application code changes yet — UI overhaul + bulk import build on top
-- of this schema in Phases E2/E3.
-- =============================================================================

-- ─── members: new personal/profile fields ──────────────────────────────────
-- Existing columns from migration 002 already cover: first_name, last_name,
-- phone, email, national_id, date_of_birth, gender, address, profile_photo_url.
-- Adding what the spec calls out that's missing.

ALTER TABLE members
  ADD COLUMN middle_name        VARCHAR(100),
  ADD COLUMN alternative_phone  VARCHAR(20),
  ADD COLUMN county_id          UUID REFERENCES counties (id) ON DELETE SET NULL,
  ADD COLUMN occupation         VARCHAR(150),
  -- Self-referencing FK so we can track who referred whom. ON DELETE SET NULL
  -- so a member account being removed doesn't cascade-delete their downstream
  -- referrals — they just become unattributed.
  ADD COLUMN referred_by        UUID REFERENCES members (id) ON DELETE SET NULL;

CREATE INDEX idx_members_county_id    ON members (county_id)    WHERE county_id   IS NOT NULL;
CREATE INDEX idx_members_referred_by  ON members (referred_by)  WHERE referred_by IS NOT NULL;

COMMENT ON COLUMN members.county_id IS
  'County of residence (FK to counties). Distinct from groups.county_id, which is the county where the group operates.';

-- ─── group_members: lifecycle extensions ──────────────────────────────────
-- Spec §2 wants: Active, Inactive, Suspended, Pending Approval, Blacklisted, Exited.
-- Existing member_status enum has: pending_verification, active, suspended, rejected.
-- Add the missing values. ALTER TYPE ADD VALUE IF NOT EXISTS is safe to re-run.

ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'inactive';
ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'blacklisted';
ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'exited';
ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'archived';

-- Archival metadata for soft-delete with audit trail.
ALTER TABLE group_members
  ADD COLUMN archived_at      TIMESTAMPTZ,
  ADD COLUMN archived_by      UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN blacklisted_at   TIMESTAMPTZ,
  ADD COLUMN blacklisted_by   UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN blacklist_reason TEXT,
  ADD COLUMN exited_at        TIMESTAMPTZ,
  ADD COLUMN exited_by        UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN exit_reason      TEXT;

-- ─── next_of_kin: priority-ordered emergency contacts ─────────────────────
-- Multiple rows per member; priority=1 is the primary contact. group_id is
-- denormalised so RLS filters on it directly instead of joining group_members.

CREATE TABLE next_of_kin (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID         NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id         UUID         NOT NULL REFERENCES members (id) ON DELETE CASCADE,

  full_name         VARCHAR(200) NOT NULL,
  relationship      VARCHAR(60)  NOT NULL,        -- 'spouse','parent','child','sibling','guardian',...
  phone             VARCHAR(20)  NOT NULL,
  alternative_phone VARCHAR(20),
  email             VARCHAR(255),
  address           TEXT,
  national_id       TEXT,
  priority          INTEGER      NOT NULL DEFAULT 1,
  notes             TEXT,

  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_nok_priority_positive CHECK (priority >= 1),
  CONSTRAINT chk_nok_email_valid       CHECK (email IS NULL OR position('@' in email) > 1)
);

CREATE INDEX idx_nok_member          ON next_of_kin (member_id);
CREATE INDEX idx_nok_group           ON next_of_kin (group_id);
CREATE INDEX idx_nok_member_priority ON next_of_kin (member_id, priority);

-- One primary contact (priority=1) per member, but multiple lower-priority
-- contacts are allowed. Partial unique index enforces this.
CREATE UNIQUE INDEX uq_nok_one_primary_per_member
  ON next_of_kin (member_id)
  WHERE priority = 1;

COMMENT ON TABLE next_of_kin IS
  'Member next-of-kin / emergency contacts. priority=1 is the primary contact (enforced unique per member); priority>=2 are backups in ascending order. group_id denormalised for RLS performance.';

-- ─── groups: government registration fields ───────────────────────────────
-- Spec §4 conditional logic: if is_government_registered=true, capture the
-- registration_number (already exists since migration 002), the certificate
-- file URL, and the date. UI hides these when the flag is false.

ALTER TABLE groups
  ADD COLUMN is_government_registered      BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN registration_certificate_url  TEXT,
  ADD COLUMN registration_date             DATE,
  -- Defensive check: cert URL and date only make sense when the group claims
  -- to be registered. Setting them on an unregistered group is rejected, so
  -- the flag and the data stay consistent.
  ADD CONSTRAINT chk_registration_fields_consistent
    CHECK (
      is_government_registered = true
      OR (registration_certificate_url IS NULL AND registration_date IS NULL)
    );

-- ─── RLS for next_of_kin ──────────────────────────────────────────────────

ALTER TABLE next_of_kin ENABLE ROW LEVEL SECURITY;
ALTER TABLE next_of_kin FORCE  ROW LEVEL SECURITY;

CREATE POLICY next_of_kin_select ON next_of_kin
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

-- Only group_admin / secretary can modify next-of-kin records. Treasurers and
-- regular members can read (for emergency-contact lookups) but not write.
CREATE POLICY next_of_kin_modify ON next_of_kin
  FOR ALL USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('group_admin', 'secretary')
    )
  );
