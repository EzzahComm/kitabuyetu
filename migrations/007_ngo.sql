-- =============================================================================
-- 007_ngo.sql
-- NGO entities and their access mappings to groups
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ngos
-- An NGO is a platform-level entity (not scoped to a single group).
-- NGO coordinators are members who have platform_role = 'ngo_coordinator'.
-- ---------------------------------------------------------------------------
CREATE TABLE ngos (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  registration_number   VARCHAR(100),
  phone                 VARCHAR(20),
  email                 VARCHAR(255),
  address               TEXT,
  county                VARCHAR(100),
  -- The primary coordinator is a member with ngo_coordinator platform_role
  coordinator_member_id UUID        REFERENCES members (id) ON DELETE SET NULL,
  is_active             BOOLEAN     NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ngos_reg_number_unique UNIQUE (registration_number)
);

CREATE INDEX idx_ngos_coordinator ON ngos (coordinator_member_id);
CREATE INDEX idx_ngos_is_active   ON ngos (is_active);

-- ---------------------------------------------------------------------------
-- ngo_group_access
-- Many-to-many between NGOs and groups.
-- An NGO can oversee multiple groups; a group can be monitored by multiple NGOs.
-- access_level determines what the NGO can see (aggregated/anonymized data only).
-- ---------------------------------------------------------------------------
CREATE TABLE ngo_group_access (
  id            UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  ngo_id        UUID             NOT NULL REFERENCES ngos   (id) ON DELETE CASCADE,
  group_id      UUID             NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  access_level  ngo_access_level NOT NULL DEFAULT 'read',
  granted_by    UUID             NOT NULL REFERENCES members (id) ON DELETE RESTRICT,
  granted_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID             REFERENCES members (id) ON DELETE SET NULL,
  is_active     BOOLEAN          NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ      NOT NULL DEFAULT NOW(),

  CONSTRAINT ngo_group_access_unique UNIQUE (ngo_id, group_id)
);

CREATE INDEX idx_ngo_group_access_ngo_id   ON ngo_group_access (ngo_id);
CREATE INDEX idx_ngo_group_access_group_id ON ngo_group_access (group_id);
CREATE INDEX idx_ngo_group_access_active   ON ngo_group_access (ngo_id, is_active);
