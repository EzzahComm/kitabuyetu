-- ─────────────────────────────────────────────────────────────────────────────
-- 206: Organization↔group link requests (platform-admin approval) +
--      register_organization() RPC (self-serve Enterprise signup)
--
-- PART 1 — organization_group_access gets a request/approval lifecycle.
-- Today this table is a bare grant/revoke shape with no application code
-- writing to it at all (only test fixtures do; 3 rows exist in production,
-- all pre-existing grants). Either a group or an organization can request a
-- link; a platform admin approves or rejects — no counter-party consent
-- required. `granted_by` was NOT NULL, meaning every row had to already know
-- its granter at insert time; a pending request doesn't have one yet, so it
-- drops to nullable and `reviewed_by` takes over that role at decision time.
--
-- PART 2 — register_organization() mirrors register_group() (migration 032)
-- but is deliberately narrower: an organization coordinator is platform
-- staff, not a chama member, so there is no person/group_members/
-- group_officers/chart-of-accounts seeding here — just organizations +
-- members + organization_members. Plan assignment (organization_subscriptions)
-- is intentionally NOT done in this RPC — it reuses the existing, tested
-- assignOrganizationPlan() (lib/services/organization-plan.service.ts) from
-- the route handler right after this RPC returns, in the same withAdminDb
-- transaction, so plan-limit/fee logic has exactly one source of truth
-- instead of being duplicated here in SQL.
--
-- This is a deliberate reversal of organization_subscriptions' own RLS
-- comment ("organizations never self-serve a plan... only super_admin
-- creates organizations") — chosen explicitly for instant self-serve
-- signup. The RLS policy text is untouched; this RPC reaches it the same
-- way register_group already reaches otherwise-RLS-protected tables for an
-- anonymous registrant — SECURITY DEFINER, EXECUTE revoked from PUBLIC,
-- granted only to postgres, called via withAdminDb's privileged connection.
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══ PART 1: organization_group_access request/approval lifecycle ═══════════

CREATE TYPE organization_group_link_status AS ENUM ('pending', 'approved', 'rejected');

ALTER TABLE organization_group_access
  ADD COLUMN status            organization_group_link_status NOT NULL DEFAULT 'pending',
  ADD COLUMN requested_by      UUID REFERENCES members (id),
  ADD COLUMN requested_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN reviewed_by       UUID REFERENCES members (id),
  ADD COLUMN reviewed_at       TIMESTAMPTZ,
  ADD COLUMN rejection_reason  TEXT;

ALTER TABLE organization_group_access
  ALTER COLUMN granted_by DROP NOT NULL;

-- Backfill: every row that already existed represents a completed grant from
-- before this workflow existed — not a pending request.
UPDATE organization_group_access
SET    status        = 'approved',
       requested_by  = granted_by,
       requested_at  = granted_at,
       reviewed_by   = granted_by,
       reviewed_at   = granted_at;

-- One live (pending or approved) link per org/group pair at a time. A
-- rejected row doesn't block a fresh request — that's a new row.
CREATE UNIQUE INDEX idx_org_group_access_one_live
  ON organization_group_access (organization_id, group_id)
  WHERE status IN ('pending', 'approved');

CREATE INDEX idx_org_group_access_pending
  ON organization_group_access (requested_at)
  WHERE status = 'pending';

COMMENT ON COLUMN organization_group_access.status IS
  'pending: awaiting platform-admin review. approved: live link (is_active should be true). rejected: decided no, kept for history — a new request is a new row.';
COMMENT ON COLUMN organization_group_access.granted_by IS
  'Set at approval time (same actor as reviewed_by for an approved row). NULL while pending or rejected.';

-- ═══ PART 2: register_organization() ═════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.register_organization(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Input — organization
  v_org_name          TEXT;
  v_org_type          organization_type;
  v_registration_no   TEXT;
  v_org_phone         TEXT;
  v_org_email         TEXT;
  v_county            TEXT;
  v_address           TEXT;

  -- Input — first coordinator
  v_first_name        TEXT;
  v_last_name         TEXT;
  v_phone             TEXT;
  v_email             TEXT;
  v_password_hash     TEXT;

  -- Output
  v_org_id            UUID;
  v_member_id         UUID;
  v_org_member_id      UUID;
  v_platform_role     platform_role;
BEGIN
  -- ── Extract + cast payload ────────────────────────────────────────────────
  v_org_name        := p_payload->>'organizationName';
  v_org_type        := NULLIF(p_payload->>'organizationType', '')::organization_type;
  v_registration_no := NULLIF(p_payload->>'registrationNumber', '');
  v_org_phone       := NULLIF(p_payload->>'organizationPhone', '');
  v_org_email       := NULLIF(p_payload->>'organizationEmail', '');
  v_county          := NULLIF(p_payload->>'county', '');
  v_address         := NULLIF(p_payload->>'address', '');

  v_first_name      := p_payload->>'firstName';
  v_last_name       := p_payload->>'lastName';
  v_phone           := p_payload->>'phone';
  v_email           := NULLIF(p_payload->>'email', '');
  v_password_hash   := p_payload->>'passwordHash';

  -- ── Required-field validation (defence in depth — UI validates first) ─────
  IF v_org_name IS NULL OR length(trim(v_org_name)) < 3 THEN
    RAISE EXCEPTION 'organization_name must be at least 3 characters' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL OR v_phone !~ '^254(7|1)[0-9]{8}$' THEN
    RAISE EXCEPTION 'phone must be E.164 Kenyan format (2547######## or 2541########)' USING ERRCODE = '22023';
  END IF;
  IF v_password_hash IS NULL OR length(v_password_hash) < 20 THEN
    RAISE EXCEPTION 'password_hash missing or too short' USING ERRCODE = '22023';
  END IF;
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'firstName and lastName are required' USING ERRCODE = '22023';
  END IF;
  -- No default: 'ngo' is one of eight organization_type values (migration 050
  -- broadened this table from NGO-specific to any institution type — bank,
  -- sacco, foundation, government, cooperative, faith_based, other). Silently
  -- defaulting an unselected signup to 'ngo' would misrepresent a SACCO or
  -- bank that skips the field, so it's a required, explicit choice.
  IF v_org_type IS NULL THEN
    RAISE EXCEPTION 'organizationType is required' USING ERRCODE = '22023';
  END IF;

  -- ── Create the organization ──────────────────────────────────────────────
  INSERT INTO organizations (
    name, type, registration_number, phone, email, county, address, is_active
  ) VALUES (
    v_org_name, v_org_type, v_registration_no, v_org_phone, v_org_email, v_county, v_address, true
  )
  RETURNING id INTO v_org_id;

  -- ── Create the coordinator account (auth identity) ───────────────────────
  -- members.phone is globally UNIQUE — duplicate phones raise 23505, which
  -- the route catches and returns as DUPLICATE_PHONE (same convention as
  -- register_group).
  INSERT INTO members (
    phone, email, password_hash, first_name, last_name, platform_role
  ) VALUES (
    v_phone, v_email, v_password_hash, v_first_name, v_last_name, 'organization_coordinator'
  )
  RETURNING id, platform_role INTO v_member_id, v_platform_role;

  -- ── Link coordinator to the organization as its lead ─────────────────────
  INSERT INTO organization_members (organization_id, member_id, org_role, status)
  VALUES (v_org_id, v_member_id, 'lead', 'active')
  RETURNING id INTO v_org_member_id;

  RETURN jsonb_build_object(
    'success',          true,
    'organization_id',  v_org_id,
    'organization_name', v_org_name,
    'member_id',        v_member_id,
    'organization_member_id', v_org_member_id,
    'platform_role',    v_platform_role
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_organization(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_organization(JSONB) TO postgres;

COMMENT ON FUNCTION public.register_organization(JSONB) IS
  'Atomic Enterprise self-serve signup: creates the organization + its first coordinator account + the organization_members link in one transaction. Plan assignment is a separate call to assignOrganizationPlan() from the route handler, not done here — see this migration''s header.';
