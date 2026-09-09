-- =============================================================================
-- 046_register_group_verification.sql
-- Phase D Part 2: registrant verification (email link + SMS OTP).
--
-- Two changes:
--   1. register_group() now lands new groups at status='pending_verification'
--      instead of 'active' (the MVP shortcut).
--   2. Three new SECURITY DEFINER RPCs drive the verification flow:
--        • start_registrant_verification    — invalidate prior open row, insert
--                                              new row with the secret_hash
--                                              (24h email / 10min SMS).
--        • complete_registrant_verification — auth'd consume path; checks hash,
--                                              expiry, and attempts ≤ 5. Flips
--                                              groups.status to 'active' on
--                                              success.
--        • complete_email_verification      — public link consume path; looks
--                                              up the open email row by hash
--                                              alone (the token IS the proof).
--
-- A partial index on registrant_verifications.secret_hash (where open + email)
-- supports the public-link lookup.
--
-- No data backfill — verification rows are short-lived and existing groups
-- (created at 'active' under the MVP shortcut) stay 'active'.
-- =============================================================================

-- ── Index for the public email-link lookup ──────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reg_verif_email_hash
  ON registrant_verifications (secret_hash)
  WHERE consumed_at IS NULL AND channel = 'email';

-- ── 1. register_group: pending_verification on insert ───────────────────────
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
    WHEN 'chairperson' THEN 'group_admin'::member_role
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

COMMENT ON FUNCTION public.register_group(JSONB) IS
  'Atomic group onboarding. Allocates KY-prefixed group_code + member_code, creates the group + person + member + officer + billing + chart of accounts in one transaction. Phase D Part 2 — lands at status=pending_verification; promoted to active by start_registrant_verification + complete_registrant_verification.';

-- ── 2. start_registrant_verification ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_registrant_verification(
  p_group_id     UUID,
  p_channel      verification_channel,
  p_destination  TEXT,
  p_secret_hash  VARCHAR(64)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_status group_status;
  v_expires_at   TIMESTAMPTZ;
  v_id           UUID;
BEGIN
  SELECT status INTO v_group_status FROM groups WHERE id = p_group_id;
  IF v_group_status IS NULL THEN
    RAISE EXCEPTION 'group not found' USING ERRCODE = '22023';
  END IF;
  IF v_group_status <> 'pending_verification' THEN
    RAISE EXCEPTION 'group is not awaiting verification (status=%)', v_group_status USING ERRCODE = '22023';
  END IF;

  -- Defence-in-depth for SMS destination — table CHECK enforces too.
  IF p_channel = 'sms' AND p_destination !~ '^254(7|1)[0-9]{8}$' THEN
    RAISE EXCEPTION 'sms destination must be Kenyan E.164 (2547######## or 2541########)' USING ERRCODE = '22023';
  END IF;

  -- Invalidate any prior open verification row for this group. Two parallel
  -- "send" clicks from the same user collapse to one open row this way.
  UPDATE registrant_verifications
     SET consumed_at = NOW()
   WHERE group_id = p_group_id
     AND consumed_at IS NULL;

  v_expires_at := CASE
    WHEN p_channel = 'email' THEN NOW() + INTERVAL '24 hours'
    ELSE                          NOW() + INTERVAL '10 minutes'
  END;

  INSERT INTO registrant_verifications (group_id, channel, destination, secret_hash, expires_at)
  VALUES (p_group_id, p_channel, p_destination, p_secret_hash, v_expires_at)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'expires_at', v_expires_at);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.start_registrant_verification(UUID, verification_channel, TEXT, VARCHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.start_registrant_verification(UUID, verification_channel, TEXT, VARCHAR) TO postgres;

COMMENT ON FUNCTION public.start_registrant_verification(UUID, verification_channel, TEXT, VARCHAR) IS
  'Phase D Part 2 — creates a fresh registrant verification row, invalidating any prior open one. Caller passes the SHA-256 hash of the plaintext token/OTP; the plaintext is delivered via Resend / Safaricom outside the DB.';

-- ── 3. complete_registrant_verification (auth path) ─────────────────────────
-- Used by /api/v1/auth/verify/complete for the SMS-OTP path. The registrant
-- is authenticated; we look up the open row by group + channel, verify the
-- hash, count the attempt, and flip the group on success.

CREATE OR REPLACE FUNCTION public.complete_registrant_verification(
  p_group_id     UUID,
  p_channel      verification_channel,
  p_secret_hash  VARCHAR(64)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row           registrant_verifications%ROWTYPE;
  v_activator_id  UUID;
BEGIN
  SELECT *
    INTO v_row
    FROM registrant_verifications
   WHERE group_id   = p_group_id
     AND channel    = p_channel
     AND consumed_at IS NULL
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'no open verification for this group/channel' USING ERRCODE = '22023';
  END IF;

  IF v_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'OTP_EXPIRED' USING ERRCODE = '22023';
  END IF;

  -- SMS only: count this attempt. Email-link path doesn't increment because
  -- mistypes don't make sense for a 43-char base64 token.
  IF p_channel = 'sms' THEN
    UPDATE registrant_verifications
       SET attempts = attempts + 1
     WHERE id = v_row.id
     RETURNING attempts INTO v_row.attempts;

    IF v_row.attempts > 5 THEN
      RAISE EXCEPTION 'OTP_TOO_MANY_ATTEMPTS' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_row.secret_hash <> p_secret_hash THEN
    -- Do NOT consume the row on mismatch — let the attempts counter govern.
    RAISE EXCEPTION 'OTP_INVALID' USING ERRCODE = '22023';
  END IF;

  -- Pick the registrant (creator officer) as `activated_by`. Falls back to
  -- NULL if for some reason no officer is found (shouldn't happen because
  -- register_group seeds one in the same transaction).
  SELECT member_id INTO v_activator_id
    FROM group_officers
   WHERE group_id   = p_group_id
     AND removed_at IS NULL
   ORDER BY created_at ASC
   LIMIT 1;

  UPDATE registrant_verifications
     SET consumed_at = NOW()
   WHERE id = v_row.id;

  -- Status guard prevents a double-activation race.
  UPDATE groups
     SET status       = 'active',
         activated_at = NOW(),
         activated_by = v_activator_id
   WHERE id     = p_group_id
     AND status = 'pending_verification';

  RETURN jsonb_build_object(
    'success',   true,
    'status',    'active',
    'group_id',  p_group_id,
    'member_id', v_activator_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_registrant_verification(UUID, verification_channel, VARCHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.complete_registrant_verification(UUID, verification_channel, VARCHAR) TO postgres;

COMMENT ON FUNCTION public.complete_registrant_verification(UUID, verification_channel, VARCHAR) IS
  'Phase D Part 2 — auth path. Verifies hash + expiry + attempts (SMS), consumes the row, flips group to active. Raises 22023 with OTP_INVALID / OTP_EXPIRED / OTP_TOO_MANY_ATTEMPTS.';

-- ── 4. complete_email_verification (public-link path) ───────────────────────
-- The token IS the proof — caller does not need to be authenticated. Finds
-- the open email row purely by hash (partial UNIQUE-style index above).

CREATE OR REPLACE FUNCTION public.complete_email_verification(
  p_secret_hash VARCHAR(64)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row           registrant_verifications%ROWTYPE;
  v_activator_id  UUID;
BEGIN
  SELECT *
    INTO v_row
    FROM registrant_verifications
   WHERE secret_hash = p_secret_hash
     AND channel     = 'email'
     AND consumed_at IS NULL
   LIMIT 1
   FOR UPDATE;

  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'LINK_INVALID' USING ERRCODE = '22023';
  END IF;

  IF v_row.expires_at < NOW() THEN
    RAISE EXCEPTION 'LINK_EXPIRED' USING ERRCODE = '22023';
  END IF;

  SELECT member_id INTO v_activator_id
    FROM group_officers
   WHERE group_id   = v_row.group_id
     AND removed_at IS NULL
   ORDER BY created_at ASC
   LIMIT 1;

  UPDATE registrant_verifications
     SET consumed_at = NOW()
   WHERE id = v_row.id;

  UPDATE groups
     SET status       = 'active',
         activated_at = NOW(),
         activated_by = v_activator_id
   WHERE id     = v_row.group_id
     AND status = 'pending_verification';

  RETURN jsonb_build_object(
    'success',  true,
    'status',   'active',
    'group_id', v_row.group_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_email_verification(VARCHAR) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.complete_email_verification(VARCHAR) TO postgres;

COMMENT ON FUNCTION public.complete_email_verification(VARCHAR) IS
  'Phase D Part 2 — public-link path. The token itself proves possession, so no auth context is needed. Looks up the open email row by hash, validates expiry, consumes the row, and flips group to active.';
