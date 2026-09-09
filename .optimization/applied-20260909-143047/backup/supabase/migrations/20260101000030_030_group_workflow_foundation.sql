-- =============================================================================
-- 014_group_workflow_foundation.sql
-- Phase A of the group registration workflow spec (v2).
--
-- Adds, in one additive migration:
--   • Lifecycle enums (group_status / member_status / primary_objective / etc.)
--   • Identifier scheme (§0A): group_code, member_code, per-group counter
--   • Shared person identity (§0A): cross-group linkage by national_id
--   • Governance positions (§2): group_officers table + creator_role
--   • Registrant verification (§4A): registrant_verifications table (email/SMS)
--   • Idempotency store (§8.3): idempotency_keys table
--
-- No code is wired to these yet — that arrives in Phase D when the atomic
-- register_group / activate_group RPCs are introduced.
--
-- Backfill is defensive: empty dev databases run cleanly, and dev environments
-- with seeded rows get plausible values so the NOT NULL constraints can apply.
-- =============================================================================

-- ─── New enums ───────────────────────────────────────────────────────────────
-- group_status order matches the lifecycle in §0/§9:
-- PENDING_VERIFICATION → DRAFT → PENDING_ACTIVATION → ACTIVE → SUSPENDED → ARCHIVED

CREATE TYPE group_status AS ENUM (
  'pending_verification',
  'draft',
  'pending_activation',
  'active',
  'suspended',
  'archived'
);

CREATE TYPE member_status AS ENUM (
  'pending_verification',
  'active',
  'suspended',
  'rejected'
);

CREATE TYPE primary_objective AS ENUM (
  'savings',
  'table_banking',
  'welfare',
  'women_empowerment',
  'youth_development',
  'agriculture',
  'business_investment',
  'housing',
  'education',
  'health',
  'community_development',
  'other'
);

CREATE TYPE meeting_frequency AS ENUM (
  'weekly',
  'biweekly',
  'monthly'
);

CREATE TYPE meeting_day AS ENUM (
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday'
);

-- Formal governance positions. Distinct from member_role on group_members
-- (which classifies a member's day-to-day role). Officers represent the
-- elected leadership; a member can hold at most one active officer role.
CREATE TYPE officer_role AS ENUM (
  'chairperson',
  'vice_chairperson',
  'secretary',
  'assistant_secretary',
  'treasurer',
  'auditor'
);

CREATE TYPE verification_channel AS ENUM ('email', 'sms');

-- ─── Identifier scheme (§0A) ────────────────────────────────────────────────

-- Global group sequence. Always allocated via nextval() inside register_group()
-- so concurrent registrations are collision-free. Rolled-back transactions
-- skip a number (gap-tolerant) but never reuse one.
CREATE SEQUENCE group_seq START 1 MINVALUE 1 NO CYCLE;

-- Per-group member counter. Concurrent member inserts take a row lock here:
--   UPDATE group_member_counters SET last_seq = last_seq + 1
--     WHERE group_id = $1 RETURNING last_seq;
CREATE TABLE group_member_counters (
  group_id  UUID PRIMARY KEY REFERENCES groups (id) ON DELETE CASCADE,
  last_seq  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_member_counter_nonneg CHECK (last_seq >= 0)
);

COMMENT ON TABLE group_member_counters IS
  'Concurrency-safe per-group sequence for member_code allocation. Acquire row lock with FOR UPDATE during member create / CSV import.';

-- ─── Shared person identity (§0A) ────────────────────────────────────────────
-- One row per real human, keyed by national_id. A person can be a member of
-- many groups; each membership references this row via group_members.person_id.
-- This enables cross-group features (aggregate savings, loan exposure, KYC
-- reuse) without merging the groups themselves. RLS treats this as a
-- privileged-read table — see policies below.

CREATE TABLE person (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- TEXT (no length cap). National IDs vary across countries (KE 8 digits,
  -- passport ~20 chars). Input-layer validation enforces real formats; here
  -- we just need uniqueness so cross-group identity resolves cleanly.
  national_id  TEXT         NOT NULL UNIQUE,
  full_name    VARCHAR(200) NOT NULL,
  dob          DATE         NOT NULL,
  phone        VARCHAR(20),
  gender       gender,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_person_phone ON person (phone) WHERE phone IS NOT NULL;

COMMENT ON TABLE person IS
  'Cross-group identity root. One row per real human (unique national_id). Never readable across tenants directly — exposed only through controlled per-group joins on group_members.person_id, or through privileged reporting paths.';

-- ─── Extend groups with workflow + identity fields ───────────────────────────

ALTER TABLE groups
  ADD COLUMN status               group_status         NOT NULL DEFAULT 'active',
  ADD COLUMN group_code           TEXT,
  ADD COLUMN creator_role         officer_role,
  ADD COLUMN primary_objective    primary_objective,
  ADD COLUMN secondary_objectives primary_objective[],
  ADD COLUMN sub_county           VARCHAR(100),
  ADD COLUMN ward                 VARCHAR(100),
  ADD COLUMN village_estate       VARCHAR(200),
  ADD COLUMN meeting_frequency    meeting_frequency,
  ADD COLUMN meeting_day          meeting_day,
  ADD COLUMN meeting_time         TIME,
  ADD COLUMN activated_at         TIMESTAMPTZ,
  ADD COLUMN activated_by         UUID REFERENCES members (id) ON DELETE SET NULL;

-- Backfill group_code for any existing dev rows from the new sequence. Empty
-- DBs no-op; populated dev DBs get well-formed codes so the NOT NULL holds.
UPDATE groups
SET    group_code = 'KY' || LPAD(NEXTVAL('group_seq')::text, 7, '0')
WHERE  group_code IS NULL;

ALTER TABLE groups
  ALTER COLUMN group_code SET NOT NULL,
  ADD CONSTRAINT groups_group_code_unique UNIQUE (group_code),
  ADD CONSTRAINT chk_group_code_format    CHECK (group_code ~ '^KY[0-9]{7}$'),
  -- The creator (registrant) must take one of the three mandatory officer
  -- positions. Existing dev rows are allowed NULL so the migration applies
  -- cleanly; new rows arrive via register_group() which sets it explicitly.
  ADD CONSTRAINT chk_creator_role
    CHECK (creator_role IS NULL OR creator_role IN ('chairperson', 'secretary', 'treasurer'));

CREATE INDEX idx_groups_status              ON groups (status);
CREATE INDEX idx_groups_primary_objective   ON groups (primary_objective) WHERE primary_objective IS NOT NULL;
CREATE INDEX idx_groups_county              ON groups (county)            WHERE county IS NOT NULL;

-- Unique group name per county. Excludes archived groups so names can be
-- recycled. Lowercase + trim to avoid case/whitespace bypasses.
CREATE UNIQUE INDEX uq_group_name_per_county
  ON groups (lower(trim(name)), county)
  WHERE status <> 'archived' AND county IS NOT NULL;

-- Seed counter rows for any existing dev groups so member_code allocation
-- works for them too.
INSERT INTO group_member_counters (group_id, last_seq)
SELECT id, 0 FROM groups
ON CONFLICT (group_id) DO NOTHING;

-- ─── Extend group_members with identity, code, status ────────────────────────

ALTER TABLE group_members
  ADD COLUMN person_id     UUID,
  ADD COLUMN member_code   TEXT,
  ADD COLUMN status        member_status NOT NULL DEFAULT 'active',
  ADD COLUMN verified_at   TIMESTAMPTZ,
  ADD COLUMN verified_by   UUID REFERENCES members (id) ON DELETE SET NULL,
  ADD COLUMN rejected_at   TIMESTAMPTZ,
  ADD COLUMN reject_reason TEXT;

-- Backfill: for each existing member, ensure a person row exists keyed on
-- their (possibly null) national_id. If national_id is null in dev seed data,
-- synthesise a placeholder so the NOT NULL constraint on person.national_id
-- holds — production data always supplies it.
INSERT INTO person (id, national_id, full_name, dob, phone, gender)
SELECT
  gen_random_uuid(),
  COALESCE(m.national_id, 'TEMP-' || m.id::text),
  TRIM(BOTH ' ' FROM (m.first_name || ' ' || m.last_name)),
  COALESCE(m.date_of_birth, DATE '1970-01-01'),
  m.phone,
  m.gender
FROM members m
WHERE NOT EXISTS (
  SELECT 1 FROM person p
  WHERE p.national_id = COALESCE(m.national_id, 'TEMP-' || m.id::text)
);

-- Link existing group_members rows to their person row.
UPDATE group_members gm
SET person_id = (
  SELECT p.id FROM person p
  JOIN members m ON m.id = gm.member_id
  WHERE p.national_id = COALESCE(m.national_id, 'TEMP-' || m.id::text)
)
WHERE gm.person_id IS NULL;

-- Assign sequential member_code values per group. Uses a window function on
-- created_at so deterministic ordering — earliest member gets 00001.
WITH ordered AS (
  SELECT
    gm.id,
    g.group_code,
    ROW_NUMBER() OVER (PARTITION BY gm.group_id ORDER BY gm.created_at, gm.id) AS seq
  FROM group_members gm
  JOIN groups g ON g.id = gm.group_id
  WHERE gm.member_code IS NULL
)
UPDATE group_members gm
SET    member_code = o.group_code || LPAD(o.seq::text, 5, '0')
FROM   ordered o
WHERE  gm.id = o.id;

-- Sync each counter to the highest seq just assigned.
UPDATE group_member_counters gmc
SET    last_seq = sub.max_seq
FROM (
  SELECT
    group_id,
    MAX(SUBSTR(member_code, 10)::int) AS max_seq  -- chars 10–14 = the 5-digit member sequence
  FROM group_members
  WHERE member_code IS NOT NULL
  GROUP BY group_id
) sub
WHERE gmc.group_id = sub.group_id;

ALTER TABLE group_members
  ALTER COLUMN person_id   SET NOT NULL,
  ALTER COLUMN member_code SET NOT NULL,
  ADD CONSTRAINT group_members_person_fk
    FOREIGN KEY (person_id) REFERENCES person (id) ON DELETE RESTRICT,
  ADD CONSTRAINT chk_member_code_format
    CHECK (member_code ~ '^KY[0-9]{12}$');

-- One person per group (a person joins a given group at most once).
CREATE UNIQUE INDEX uq_person_per_group        ON group_members (group_id, person_id);
-- Member code unique within a group.
CREATE UNIQUE INDEX uq_member_code_per_group   ON group_members (group_id, member_code);
CREATE INDEX        idx_group_members_status   ON group_members (group_id, status);
CREATE INDEX        idx_group_members_person   ON group_members (person_id);

-- 12-digit M-Pesa STK Push reference: member_code minus the constant 'KY' prefix.
-- Generated + stored so the M-Pesa callback resolves it with a single indexed
-- lookup. Length matches the documented STK Push AccountReference limit (§0B).
ALTER TABLE group_members
  ADD COLUMN mpesa_ref TEXT GENERATED ALWAYS AS (SUBSTR(member_code, 3)) STORED;

CREATE UNIQUE INDEX uq_mpesa_ref ON group_members (mpesa_ref);

COMMENT ON COLUMN group_members.mpesa_ref IS
  '12-digit derived M-Pesa AccountReference (group_seq || member_seq). Used to route C2B/STK callbacks to the correct (group, member) tuple deterministically. See §0B.';

-- ─── group_officers — formal governance positions ───────────────────────────

CREATE TABLE group_officers (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID         NOT NULL,
  member_id       UUID         NOT NULL,
  role            officer_role NOT NULL,
  appointed_at    DATE         NOT NULL DEFAULT CURRENT_DATE,
  appointed_by    UUID         REFERENCES members (id) ON DELETE SET NULL,
  removed_at      DATE,
  removed_by      UUID         REFERENCES members (id) ON DELETE SET NULL,
  removal_reason  TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  -- An officer must already be a member of the same group (composite FK).
  CONSTRAINT officer_must_be_group_member
    FOREIGN KEY (group_id, member_id)
    REFERENCES group_members (group_id, member_id)
    ON DELETE CASCADE,

  CONSTRAINT officer_removal_consistent
    CHECK (
      (removed_at IS NULL AND removed_by IS NULL AND removal_reason IS NULL)
      OR (removed_at IS NOT NULL)
    )
);

-- One holder per mandatory role per group (active holders only).
CREATE UNIQUE INDEX uq_one_holder_per_mandatory_role
  ON group_officers (group_id, role)
  WHERE removed_at IS NULL
    AND role IN ('chairperson', 'secretary', 'treasurer');

-- A member can hold at most one active officer role per group. The
-- group-level `allow_multi_role` exception (§2) is handled at the
-- application layer when present; the default constraint enforces the
-- common case.
CREATE UNIQUE INDEX uq_one_active_role_per_member_per_group
  ON group_officers (group_id, member_id)
  WHERE removed_at IS NULL;

CREATE INDEX idx_group_officers_group_id    ON group_officers (group_id);
CREATE INDEX idx_group_officers_member_id   ON group_officers (member_id);
CREATE INDEX idx_group_officers_role        ON group_officers (group_id, role);

COMMENT ON TABLE group_officers IS
  'Formal governance positions (chair, secretary, treasurer, etc). Officer must already exist in group_members. Soft-delete via removed_at — never DELETE rows to preserve audit history.';

-- ─── registrant_verifications — §4A ──────────────────────────────────────────
-- One row per verification attempt (email link OR Safaricom OTP). secret_hash
-- is SHA-256 of the token / OTP; we never store the plaintext. The actual
-- send (Resend / SMS gateway) happens AFTER commit so a transient provider
-- outage never destroys a registration — the registrant can request a resend.

CREATE TABLE registrant_verifications (
  id           UUID                 PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID                 NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  channel      verification_channel NOT NULL,
  destination  TEXT                 NOT NULL,           -- email address OR 2547######## msisdn
  secret_hash  VARCHAR(64)          NOT NULL,           -- SHA-256 of token (email) / OTP (sms)
  attempts     INTEGER              NOT NULL DEFAULT 0, -- OTP verify attempts (sms only)
  expires_at   TIMESTAMPTZ          NOT NULL,           -- email: +24h, sms: +10min
  consumed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ          NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_attempts_nonneg CHECK (attempts >= 0),
  CONSTRAINT chk_sms_destination_e164
    CHECK (
      channel <> 'sms'
      OR destination ~ '^254(7|1)[0-9]{8}$'
    )
);

-- Only one open (unconsumed) verification per group at a time. New sends
-- invalidate prior unused ones — enforced at the application layer.
CREATE INDEX idx_reg_verif_open
  ON registrant_verifications (group_id)
  WHERE consumed_at IS NULL;
CREATE INDEX idx_reg_verif_expires_at
  ON registrant_verifications (expires_at);

COMMENT ON TABLE registrant_verifications IS
  'Group registrant verification (§4A). channel=email uses a 24h signed link via Resend; channel=sms uses a 6-digit OTP delivered to Safaricom MSISDNs only (10min, max 5 attempts). secret_hash is SHA-256 of the plaintext token/OTP.';

-- ─── idempotency_keys — §8.3 ────────────────────────────────────────────────

CREATE TABLE idempotency_keys (
  key             VARCHAR(255) PRIMARY KEY,
  endpoint        VARCHAR(100) NOT NULL,
  member_id       UUID         REFERENCES members (id) ON DELETE SET NULL,
  request_hash    VARCHAR(64)  NOT NULL,
  response_status INTEGER      NOT NULL,
  response_body   JSONB        NOT NULL,
  expires_at      TIMESTAMPTZ  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_idempotency_keys_expires_at ON idempotency_keys (expires_at);

COMMENT ON TABLE idempotency_keys IS
  'Server-side idempotency store for retry-safe endpoints (registration, activation, payments). Redis is primary; this is the durable fallback. Rows are reaped on expires_at.';

-- ─── RLS — same pattern as existing tenant tables ───────────────────────────

-- person: cross-tenant table. Direct reads are not exposed to officers;
-- access happens via group_members joins. Only super_admin can SELECT
-- directly. Modifications go through service-role (no policy granted).
ALTER TABLE person                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE person                   FORCE  ROW LEVEL SECURITY;

CREATE POLICY person_select_super_only ON person
  FOR SELECT USING (is_super_admin());

-- group_member_counters: same group-scoped read; service-role writes only.
ALTER TABLE group_member_counters    ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_member_counters    FORCE  ROW LEVEL SECURITY;

CREATE POLICY group_member_counters_select ON group_member_counters
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

-- group_officers: visible to the group's members + super_admin
ALTER TABLE group_officers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_officers           FORCE  ROW LEVEL SECURITY;

CREATE POLICY group_officers_select ON group_officers
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

CREATE POLICY group_officers_modify ON group_officers
  FOR ALL USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'group_admin')
  );

-- registrant_verifications: super_admin only. The verification flow uses
-- service-role writes (no group context yet because the registrant isn't
-- authenticated until the verification completes).
ALTER TABLE registrant_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrant_verifications FORCE  ROW LEVEL SECURITY;

CREATE POLICY registrant_verifications_select_super_only ON registrant_verifications
  FOR SELECT USING (is_super_admin());

-- idempotency_keys: per-member; service-role bypass for unauthenticated paths.
ALTER TABLE idempotency_keys         ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys         FORCE  ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_select ON idempotency_keys
  FOR SELECT USING (
    is_super_admin()
    OR member_id = app_current_user_id()
  );

CREATE POLICY idempotency_keys_modify ON idempotency_keys
  FOR ALL USING (
    is_super_admin()
    OR member_id = app_current_user_id()
  );
