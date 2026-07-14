-- =============================================================================
-- 065_organization_type.sql
-- Super-admin organization onboarding (banks, SACCOs, foundations, …).
--
-- Context: `organizations` (formerly `ngos`, migration 050) is the federating
-- body that oversees many groups via `organization_group_access`. Until now it
-- had no way to distinguish a bank from a SACCO from a foundation, and no
-- application path created rows at all — only direct SQL. This adds the type
-- so super-admins can onboard and classify real organizations from the portal.
--
-- `is_active` (already on the table) remains the lifecycle flag; the admin UI
-- toggles it (active ⇄ deactivated). No separate status column is introduced.
-- =============================================================================

CREATE TYPE organization_type AS ENUM (
  'bank',
  'sacco',
  'foundation',
  'ngo',
  'government',
  'cooperative',
  'faith_based',
  'other'
);

-- Existing rows were the former NGOs — default them to 'ngo'. New onboarding
-- always supplies the type explicitly.
ALTER TABLE organizations
  ADD COLUMN type organization_type NOT NULL DEFAULT 'ngo';

COMMENT ON COLUMN organizations.type IS
  'Kind of federating body — bank | sacco | foundation | ngo | government | '
  'cooperative | faith_based | other. Set at onboarding by a super-admin.';

CREATE INDEX idx_organizations_type ON organizations (type);
