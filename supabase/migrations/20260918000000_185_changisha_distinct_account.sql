-- =============================================================================
-- 185_changisha_distinct_account.sql
-- Fix: Changi$ha donations must post to a distinct account code (4006) rather
-- than account 4001 (Member Contributions), so fundraising income is
-- classified separately from member-savings contributions in the P&L/trial
-- balance, per the explicit requirement: "Changi$ha money is never mixed with
-- Bookkeeper member finances."
-- =============================================================================

-- Add 4006 to all existing groups' charts of accounts
INSERT INTO accounts (group_id, account_code, name, type, is_system)
SELECT id, '4006', 'Changi$ha Donations', 'income', true
FROM groups
WHERE NOT EXISTS (
  SELECT 1 FROM accounts WHERE accounts.group_id = groups.id AND account_code = '4006'
);

-- Update register_group() RPC to include 4006 in the seeded accounts
-- (This will be used for all NEW groups created after this migration)
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
  v_sub_county_text   := NULLIF(p_payload->>'subCounty', '');
  v_ward_text         := NULLIF(p_payload->>'ward', '');
  v_village_estate    := NULLIF(p_payload->>'villageEstate', '');
  v_primary_objective := (p_payload->>'primaryObjective')::primary_objective;
  v_meeting_frequency := COALESCE((p_payload->>'meetingFrequency')::meeting_frequency, 'monthly');
  v_meeting_day       := COALESCE((p_payload->>'meetingDay')::meeting_day, 'saturday');
  v_meeting_time      := COALESCE((p_payload->>'meetingTime')::TIME, '14:00');
  v_national_id       := NULLIF(p_payload->>'nationalId', '');
  v_date_of_birth     := (p_payload->>'dateOfBirth')::DATE;
  v_gender            := (p_payload->>'gender')::gender;

  IF v_group_name IS NULL OR v_phone IS NULL OR v_password_hash IS NULL OR
     v_creator_role IS NULL OR v_primary_objective IS NULL THEN
    RAISE EXCEPTION 'Missing required field(s)' USING ERRCODE = '22023';
  END IF;

  IF v_county_id IS NOT NULL THEN
    SELECT name INTO v_county_name FROM counties WHERE id = v_county_id;
    IF v_county_name IS NULL THEN
      RAISE EXCEPTION 'county_id does not match any row in counties' USING ERRCODE = '22023';
    END IF;
  END IF;

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
    'group_admin', 'active'
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
    (v_group_id, '2102', 'Welfare Fund',              'liability', true),
    (v_group_id, '2103', 'Dividends Payable',         'liability', true),
    (v_group_id, '2104', 'Withholding Tax Payable',   'liability', true),
    (v_group_id, '3001', 'Member Equity',             'equity',    true),
    (v_group_id, '3101', 'Retained Surplus',          'equity',    true),
    (v_group_id, '4001', 'Member Contributions',      'income',    true),
    (v_group_id, '4002', 'Interest Income — Loans',   'income',    true),
    (v_group_id, '4003', 'Registration Fees',         'income',    true),
    (v_group_id, '4004', 'Other Income',              'income',    true),
    (v_group_id, '4005', 'External Funding',          'income',    true),
    (v_group_id, '4006', 'Changi$ha Donations',       'income',    true),
    (v_group_id, '5001', 'Administrative Expenses',   'expense',   true),
    (v_group_id, '5002', 'SMS Expenses',              'expense',   true),
    (v_group_id, '5003', 'Platform Subscription',     'expense',   true),
    (v_group_id, '5004', 'Loan Write-offs',           'expense',   true);

  RETURN jsonb_build_object(
    'success',        true,
    'group_id',       v_group_id,
    'group_code',     v_group_code,
    'group_name',     v_group_name,
    'member_id',      v_member_id,
    'member_code',    v_member_code,
    'person_id',      v_person_id,
    'platform_role',  v_platform_role,
    'creator_role',   v_creator_role
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_group(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_group(JSONB) TO postgres;
