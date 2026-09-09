-- ============================================================================
-- 050 — Rename NGO → Organization, and the group_admin role → chairperson
--
-- Two vocabulary changes that reach the whole schema:
--
--   ngos                 → organizations
--   ngo_group_access     → organization_group_access  (ngo_id → organization_id)
--   platform_role 'ngo_coordinator' → 'organization_coordinator'
--   member_role   'group_admin'     → 'chairperson'
--
-- Postgres rewrites dependent policies, views and constraints automatically on
-- ALTER TABLE/COLUMN RENAME (they bind by OID/attnum), and CREATE OR REPLACE
-- FUNCTION preserves a function's OID. What it does NOT rewrite is *string
-- literals* — and every RLS policy compares app_current_role() (TEXT) against
-- literals like 'group_admin'. Renaming an enum value alone would therefore
-- leave ~20 policies silently denying access to every chairperson, and would
-- break register_group() whose body casts 'group_admin'::member_role.
--
-- So: rename structurally, then recreate exactly the objects that embed a
-- literal — the affected policies, vw_members_masked, and register_group().
--
-- DEPLOY NOTE: JWTs issued before this migration carry role='group_admin'.
-- Those sessions will fail the recreated policies until re-issued. Invalidate
-- refresh tokens (or ship the token-mapping shim) as part of the same release.
-- ============================================================================

-- ─── Part A — structural rename: ngo → organization ─────────────────────────

ALTER TYPE  ngo_access_level          RENAME TO organization_access_level;
ALTER TABLE ngos                      RENAME TO organizations;
ALTER TABLE ngo_group_access          RENAME TO organization_group_access;
ALTER TABLE organization_group_access RENAME COLUMN ngo_id TO organization_id;

ALTER TABLE organizations             RENAME CONSTRAINT ngos_reg_number_unique
                                      TO organizations_reg_number_unique;
ALTER TABLE organization_group_access RENAME CONSTRAINT ngo_group_access_unique
                                      TO organization_group_access_unique;

ALTER INDEX idx_ngos_coordinator        RENAME TO idx_organizations_coordinator;
ALTER INDEX idx_ngos_is_active          RENAME TO idx_organizations_is_active;
ALTER INDEX idx_ngo_group_access_ngo_id RENAME TO idx_org_group_access_org_id;
ALTER INDEX idx_ngo_group_access_group_id RENAME TO idx_org_group_access_group_id;
ALTER INDEX idx_ngo_group_access_active RENAME TO idx_org_group_access_active;

ALTER VIEW vw_ngo_group_summary RENAME TO vw_organization_group_summary;

-- Rename preserves the OID, so every policy already bound to this function
-- keeps working; CREATE OR REPLACE then repoints the body at the new GUC.
ALTER FUNCTION app_current_ngo_id() RENAME TO app_current_organization_id;

CREATE OR REPLACE FUNCTION app_current_organization_id()
RETURNS UUID LANGUAGE sql STABLE SET search_path = public AS $fn$
  SELECT NULLIF(current_setting('app.current_organization_id', true), '')::uuid;
$fn$;

-- ─── Part B — enum value renames ────────────────────────────────────────────
-- Existing rows need no rewrite: the label is renamed, not the value's oid.

ALTER TYPE platform_role RENAME VALUE 'ngo_coordinator' TO 'organization_coordinator';
ALTER TYPE member_role   RENAME VALUE 'group_admin'     TO 'chairperson';

-- ─── Part C — recreate every policy that embeds a role literal ──────────────

-- groups
DROP POLICY groups_select ON groups;
CREATE POLICY groups_select ON groups
  FOR SELECT USING (
    is_super_admin()
    OR id = app_current_group_id()
    OR (
      app_current_role() = 'organization_coordinator'
      AND id IN (
        SELECT group_id FROM organization_group_access
        WHERE organization_id = app_current_organization_id()
          AND is_active = true
      )
    )
  );

DROP POLICY groups_update ON groups;
CREATE POLICY groups_update ON groups
  FOR UPDATE USING (
    is_super_admin()
    OR (id = app_current_group_id() AND app_current_role() = 'chairperson')
  );

-- members
DROP POLICY members_update ON members;
CREATE POLICY members_update ON members
  FOR UPDATE USING (
    is_super_admin()
    OR id = app_current_user_id()
    OR (
      id IN (
        SELECT gm.member_id FROM group_members gm
        WHERE gm.group_id = app_current_group_id() AND gm.is_active = true
      )
      AND app_current_role() IN ('chairperson', 'secretary')
    )
  );

-- group_members
DROP POLICY group_members_insert ON group_members;
CREATE POLICY group_members_insert ON group_members
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('chairperson', 'secretary')
    )
  );

DROP POLICY group_members_update ON group_members;
CREATE POLICY group_members_update ON group_members
  FOR UPDATE USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() = 'chairperson'
    )
  );

-- contributions
DROP POLICY contributions_select ON contributions;
CREATE POLICY contributions_select ON contributions
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (
      app_current_role() = 'organization_coordinator'
      AND group_id IN (
        SELECT group_id FROM organization_group_access
        WHERE organization_id = app_current_organization_id() AND is_active = true
      )
    )
  );
DROP POLICY contributions_insert ON contributions;
CREATE POLICY contributions_insert ON contributions
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
DROP POLICY contributions_update ON contributions;
CREATE POLICY contributions_update ON contributions
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

-- loans
DROP POLICY loans_select ON loans;
CREATE POLICY loans_select ON loans
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
    OR (
      app_current_role() = 'organization_coordinator'
      AND group_id IN (
        SELECT group_id FROM organization_group_access
        WHERE organization_id = app_current_organization_id() AND is_active = true
      )
    )
  );
DROP POLICY loans_insert ON loans;
CREATE POLICY loans_insert ON loans
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer','member'))
  );
DROP POLICY loans_update ON loans;
CREATE POLICY loans_update ON loans
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

-- loan_repayments
DROP POLICY loan_repayments_insert ON loan_repayments;
CREATE POLICY loan_repayments_insert ON loan_repayments
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
DROP POLICY loan_repayments_update ON loan_repayments;
CREATE POLICY loan_repayments_update ON loan_repayments
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

-- accounts
DROP POLICY accounts_insert ON accounts;
CREATE POLICY accounts_insert ON accounts
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
DROP POLICY accounts_update ON accounts;
CREATE POLICY accounts_update ON accounts
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer')
        AND is_system = false)
  );

-- journal_entries
DROP POLICY journal_entries_insert ON journal_entries;
CREATE POLICY journal_entries_insert ON journal_entries
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
DROP POLICY journal_entries_update ON journal_entries;
CREATE POLICY journal_entries_update ON journal_entries
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

-- journal_lines
DROP POLICY journal_lines_insert ON journal_lines;
CREATE POLICY journal_lines_insert ON journal_lines
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );
DROP POLICY journal_lines_update ON journal_lines;
CREATE POLICY journal_lines_update ON journal_lines
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND app_current_role() IN ('chairperson','treasurer'))
  );

-- notifications
DROP POLICY notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications
  FOR SELECT USING (
    is_super_admin()
    OR (group_id = app_current_group_id()
        AND (
          member_id = app_current_user_id()
          OR app_current_role() IN ('chairperson','treasurer','secretary')
        ))
  );

-- organizations (was ngos)
DROP POLICY ngos_select ON organizations;
CREATE POLICY organizations_select ON organizations
  FOR SELECT USING (
    is_super_admin()
    OR (
      app_current_role() = 'organization_coordinator'
      AND id = app_current_organization_id()
    )
  );
ALTER POLICY ngos_insert ON organizations RENAME TO organizations_insert;
ALTER POLICY ngos_update ON organizations RENAME TO organizations_update;

-- organization_group_access (was ngo_group_access)
DROP POLICY ngo_group_access_select ON organization_group_access;
CREATE POLICY organization_group_access_select ON organization_group_access
  FOR SELECT USING (
    is_super_admin()
    OR (app_current_role() = 'organization_coordinator'
        AND organization_id = app_current_organization_id())
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
  );
DROP POLICY ngo_group_access_insert ON organization_group_access;
CREATE POLICY organization_group_access_insert ON organization_group_access
  FOR INSERT WITH CHECK (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
  );
DROP POLICY ngo_group_access_update ON organization_group_access;
CREATE POLICY organization_group_access_update ON organization_group_access
  FOR UPDATE USING (
    is_super_admin()
    OR (group_id = app_current_group_id() AND app_current_role() = 'chairperson')
  );

-- ─── Part D — recreate vw_members_masked (embeds 'group_admin' literals) ────

CREATE OR REPLACE VIEW vw_members_masked WITH (security_invoker = true) AS
SELECT
  m.id,
  m.first_name,
  m.last_name,
  -- PII masked for non-privileged roles
  CASE
    WHEN app_current_role() IN ('super_admin', 'chairperson', 'treasurer')
      THEN m.phone
    ELSE mask_phone(m.phone)
  END AS phone,
  CASE
    WHEN app_current_role() IN ('super_admin', 'chairperson', 'treasurer')
      THEN m.email
    ELSE mask_email(m.email)
  END AS email,
  CASE
    WHEN app_current_role() IN ('super_admin', 'chairperson')
      THEN m.national_id
    ELSE mask_national_id(m.national_id)
  END AS national_id,
  CASE
    WHEN app_current_role() IN ('super_admin', 'chairperson')
      THEN m.date_of_birth
    ELSE NULL
  END AS date_of_birth,
  CASE
    WHEN app_current_role() IN ('super_admin', 'chairperson')
      THEN m.address
    ELSE NULL
  END AS address,
  m.gender,
  m.profile_photo_url,
  m.platform_role,
  m.is_active,
  m.last_login_at,
  m.created_at,
  m.updated_at
FROM members m;


-- ─── Part E — recreate register_group() (body casts to member_role) ────────
-- Extracted verbatim from migration 046 (the live definition); the only change
-- is the officer_role → member_role mapping now yielding chairperson.

CREATE OR REPLACE FUNCTION public.register_group(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Input
  v_group_name        TEXT;
  v_group_type        group_type;
  v_first_name        TEXT;
  v_last_name         TEXT;
  v_phone             TEXT;
  v_email             TEXT;
  v_password_hash     TEXT;
  v_creator_role      officer_role;
  v_county_id         UUID;
  v_sub_county_text   TEXT;
  v_ward_text         TEXT;
  v_village_estate    TEXT;
  v_primary_objective primary_objective;
  v_meeting_frequency meeting_frequency;
  v_meeting_day       meeting_day;
  v_meeting_time      TIME;
  v_national_id       TEXT;
  v_date_of_birth     DATE;
  v_gender            gender;
  v_county_name       TEXT;

  -- Output
  v_group_code        TEXT;
  v_group_id          UUID;
  v_person_id         UUID;
  v_member_id         UUID;
  v_member_seq        INT;
  v_member_code       TEXT;
  v_platform_role     platform_role;
  v_group_role        member_role;
BEGIN
  v_group_name        := p_payload->>'groupName';
  v_group_type        := (p_payload->>'groupType')::group_type;
  v_first_name        := p_payload->>'firstName';
  v_last_name         := p_payload->>'lastName';
  v_phone             := p_payload->>'phone';
  v_email             := NULLIF(p_payload->>'email', '');
  v_password_hash     := p_payload->>'passwordHash';
  v_creator_role      := (p_payload->>'creatorRole')::officer_role;
  v_county_id         := NULLIF(p_payload->>'countyId', '')::UUID;
  v_sub_county_text   := NULLIF(p_payload->>'subCountyText', '');
  v_ward_text         := NULLIF(p_payload->>'wardText', '');
  v_village_estate    := NULLIF(p_payload->>'villageEstate', '');
  v_primary_objective := NULLIF(p_payload->>'primaryObjective', '')::primary_objective;
  v_meeting_frequency := NULLIF(p_payload->>'meetingFrequency', '')::meeting_frequency;
  v_meeting_day       := NULLIF(p_payload->>'meetingDay', '')::meeting_day;
  v_meeting_time      := NULLIF(p_payload->>'meetingTime', '')::TIME;
  v_national_id       := NULLIF(p_payload->>'nationalId', '');
  v_date_of_birth     := NULLIF(p_payload->>'dateOfBirth', '')::DATE;
  v_gender            := NULLIF(p_payload->>'gender', '')::gender;

  IF v_group_name IS NULL OR length(trim(v_group_name)) < 3 THEN
    RAISE EXCEPTION 'group_name must be at least 3 characters' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL OR v_phone !~ '^254(7|1)[0-9]{8}$' THEN
    RAISE EXCEPTION 'phone must be E.164 Kenyan format (2547######## or 2541########)' USING ERRCODE = '22023';
  END IF;
  IF v_password_hash IS NULL OR length(v_password_hash) < 20 THEN
    RAISE EXCEPTION 'password_hash missing or too short' USING ERRCODE = '22023';
  END IF;
  IF v_creator_role NOT IN ('chairperson', 'secretary', 'treasurer') THEN
    RAISE EXCEPTION 'creator_role must be chairperson, secretary, or treasurer' USING ERRCODE = '22023';
  END IF;

  -- Map officer_role → member_role for the creator's group_members row (mig 034).
  v_group_role := CASE v_creator_role
    WHEN 'chairperson' THEN 'chairperson'::member_role
    WHEN 'secretary'   THEN 'secretary'::member_role
    WHEN 'treasurer'   THEN 'treasurer'::member_role
  END;

  v_group_code := 'KY' || LPAD(NEXTVAL('group_seq')::text, 7, '0');

  IF v_county_id IS NOT NULL THEN
    SELECT name INTO v_county_name FROM counties WHERE id = v_county_id;
    IF v_county_name IS NULL THEN
      RAISE EXCEPTION 'county_id does not match any row in counties' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Phase D Part 2: status='pending_verification'. The verify RPCs below flip
  -- to 'active' after email-link or SMS-OTP success.
  INSERT INTO groups (
    name, "type", phone, email,
    status, group_code, creator_role,
    county_id, sub_county, ward,
    county, village_estate,
    primary_objective, meeting_frequency, meeting_day, meeting_time
  ) VALUES (
    v_group_name, v_group_type, v_phone, v_email,
    'pending_verification', v_group_code, v_creator_role,
    v_county_id, v_sub_county_text, v_ward_text,
    v_county_name, v_village_estate,
    v_primary_objective, v_meeting_frequency, v_meeting_day, v_meeting_time
  )
  RETURNING id INTO v_group_id;

  INSERT INTO group_member_counters (group_id, last_seq) VALUES (v_group_id, 0);

  IF v_national_id IS NOT NULL THEN
    INSERT INTO person (national_id, full_name, dob, phone, gender)
    VALUES (
      v_national_id,
      trim(v_first_name || ' ' || v_last_name),
      COALESCE(v_date_of_birth, DATE '1970-01-01'),
      v_phone,
      v_gender
    )
    ON CONFLICT (national_id) DO UPDATE
      SET phone     = COALESCE(person.phone, EXCLUDED.phone),
          full_name = CASE WHEN person.full_name = '' THEN EXCLUDED.full_name ELSE person.full_name END
    RETURNING id INTO v_person_id;
  ELSE
    INSERT INTO person (national_id, full_name, dob, phone, gender)
    VALUES (
      'TEMP-' || gen_random_uuid()::text,
      trim(v_first_name || ' ' || v_last_name),
      COALESCE(v_date_of_birth, DATE '1970-01-01'),
      v_phone,
      v_gender
    )
    RETURNING id INTO v_person_id;
  END IF;

  INSERT INTO members (
    phone, email, password_hash,
    first_name, last_name,
    national_id, date_of_birth, gender
  ) VALUES (
    v_phone, v_email, v_password_hash,
    v_first_name, v_last_name,
    v_national_id, v_date_of_birth, v_gender
  )
  RETURNING id, platform_role INTO v_member_id, v_platform_role;

  UPDATE group_member_counters
  SET    last_seq = last_seq + 1
  WHERE  group_id = v_group_id
  RETURNING last_seq INTO v_member_seq;

  v_member_code := v_group_code || LPAD(v_member_seq::text, 5, '0');

  INSERT INTO group_members (
    group_id, member_id, person_id, member_code,
    role, status
  ) VALUES (
    v_group_id, v_member_id, v_person_id, v_member_code,
    v_group_role, 'active'
  );

  INSERT INTO group_officers (group_id, member_id, role, appointed_by)
  VALUES (v_group_id, v_member_id, v_creator_role, v_member_id);

  INSERT INTO billing_accounts (group_id) VALUES (v_group_id);

  INSERT INTO subscriptions (
    group_id, plan_type, status, started_at, monthly_fee, sms_rate, max_members
  ) VALUES (
    v_group_id, 'starter', 'active', NOW(), 0, 0.9000, NULL
  );

  INSERT INTO accounts (group_id, account_code, name, type, is_system) VALUES
    (v_group_id, '1001', 'Cash and M-Pesa',          'asset',     true),
    (v_group_id, '1002', 'Bank Account',              'asset',     true),
    (v_group_id, '1101', 'Loans Receivable',          'asset',     true),
    (v_group_id, '1201', 'Fixed Assets',              'asset',     true),
    (v_group_id, '2001', 'Accounts Payable',          'liability', true),
    (v_group_id, '2101', 'Member Savings',            'liability', true),
    (v_group_id, '3001', 'Member Equity',             'equity',    true),
    (v_group_id, '3101', 'Retained Surplus',          'equity',    true),
    (v_group_id, '4001', 'Member Contributions',      'income',    true),
    (v_group_id, '4002', 'Interest Income — Loans',   'income',    true),
    (v_group_id, '4003', 'Registration Fees',         'income',    true),
    (v_group_id, '4004', 'Other Income',              'income',    true),
    (v_group_id, '5001', 'Administrative Expenses',   'expense',   true),
    (v_group_id, '5002', 'SMS Expenses',              'expense',   true),
    (v_group_id, '5003', 'Platform Subscription',     'expense',   true),
    (v_group_id, '5004', 'Loan Write-offs',           'expense',   true);

  RETURN jsonb_build_object(
    'success',        true,
    'group_id',       v_group_id,
    'group_code',     v_group_code,
    'group_name',     v_group_name,
    'group_status',   'pending_verification',
    'member_id',      v_member_id,
    'member_code',    v_member_code,
    'person_id',      v_person_id,
    'platform_role',  v_platform_role,
    'creator_role',   v_creator_role,
    'group_role',     v_group_role
  );
END;
$$;
