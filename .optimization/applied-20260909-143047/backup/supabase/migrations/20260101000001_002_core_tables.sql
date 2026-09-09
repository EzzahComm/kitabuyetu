-- =============================================================================
-- 002_core_tables.sql
-- Core tenant tables: groups, members, group_members
-- =============================================================================

-- ---------------------------------------------------------------------------
-- groups
-- The top-level tenant entity. Every data row in the system belongs to a group.
-- ---------------------------------------------------------------------------
CREATE TABLE groups (
  id                  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(255)  NOT NULL,
  type                group_type    NOT NULL DEFAULT 'chama',
  registration_number VARCHAR(100),
  phone               VARCHAR(20)   NOT NULL,
  email               VARCHAR(255),
  address             TEXT,
  county              VARCHAR(100),
  logo_url            TEXT,
  is_active           BOOLEAN       NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_groups_phone    ON groups (phone);
CREATE INDEX idx_groups_is_active ON groups (is_active);

-- ---------------------------------------------------------------------------
-- members
-- Platform-wide user accounts. A member can belong to multiple groups.
-- Phone is the primary login credential (common in East Africa).
-- ---------------------------------------------------------------------------
CREATE TABLE members (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             VARCHAR(20)   NOT NULL,
  email             VARCHAR(255),
  password_hash     VARCHAR(255)  NOT NULL,
  first_name        VARCHAR(100)  NOT NULL,
  last_name         VARCHAR(100)  NOT NULL,
  national_id       VARCHAR(20),
  date_of_birth     DATE,
  gender            gender,
  address           TEXT,
  profile_photo_url TEXT,
  platform_role     platform_role NOT NULL DEFAULT 'member',
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  email_verified    BOOLEAN       NOT NULL DEFAULT false,
  phone_verified    BOOLEAN       NOT NULL DEFAULT false,
  last_login_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  CONSTRAINT members_phone_unique  UNIQUE (phone),
  CONSTRAINT members_email_unique  UNIQUE (email),
  CONSTRAINT members_nat_id_unique UNIQUE (national_id)
);

CREATE INDEX idx_members_phone         ON members (phone);
CREATE INDEX idx_members_email         ON members (email);
CREATE INDEX idx_members_platform_role ON members (platform_role);
CREATE INDEX idx_members_is_active     ON members (is_active);

-- ---------------------------------------------------------------------------
-- group_members
-- Join table linking members to groups with a per-group role.
-- A member can have different roles in different groups.
-- ---------------------------------------------------------------------------
CREATE TABLE group_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID        NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id   UUID        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  role        member_role NOT NULL DEFAULT 'member',
  joined_at   DATE        NOT NULL DEFAULT CURRENT_DATE,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  invited_by  UUID        REFERENCES members (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT group_members_unique UNIQUE (group_id, member_id)
);

CREATE INDEX idx_group_members_group_id  ON group_members (group_id);
CREATE INDEX idx_group_members_member_id ON group_members (member_id);
CREATE INDEX idx_group_members_role      ON group_members (group_id, role);
CREATE INDEX idx_group_members_active    ON group_members (group_id, is_active);

-- ---------------------------------------------------------------------------
-- refresh_tokens
-- Stored refresh tokens for JWT rotation. Redis is primary; this is the
-- persistent fallback used for revocation checks on sensitive operations.
-- ---------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   UUID        NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT refresh_tokens_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX idx_refresh_tokens_member_id  ON refresh_tokens (member_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens (expires_at);
