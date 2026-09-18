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
--
-- CORRECTED: the version originally committed here was reconstructed by hand
-- from an old snapshot rather than the function's real current state, and
-- had drifted badly — missing v_group_code's assignment entirely (NOT NULL
-- violation on every call), missing the pending_verification signup flow,
-- the Kitabu Yetu / Chama Reminder product split (migration 127) and its
-- seed_chart_of_accounts() call, the "no free subscription" fix (migration
-- 139 — this version still inserted a free active starter subscription,
-- which migration 139 exists specifically to prevent), the officer_role ->
-- member_role mapping (migration 034), the 'group_admin' -> 'chairperson'
-- rename (migration 050), and read subCounty/ward instead of the real
-- payload keys subCountyText/wardText. None of this ever reached production
-- — this file was applied, but a later out-of-band fix corrected
-- register_group() directly without a migration ever capturing it, so
-- production has been running the correct function throughout. Only a fresh
-- replay (CI, a clean local db) ever saw the broken version here, which is
-- what CI's Tenant Isolation job caught (67 of 75 suites failing on
-- createTestGroup's "null value in column group_code"). Replaced with the
-- exact function body verified live via pg_get_functiondef() against
-- production, plus this migration's own account-4006 addition.
CREATE OR REPLACE FUNCTION public.register_group(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_product           subscription_product;
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
  -- Migration 127. COALESCE before the cast, not NULLIF after it: an omitted
  -- or empty product must become kitabu_yetu, never NULL (the column is NOT NULL).
  v_product           := COALESCE(NULLIF(p_payload->>'product', ''), 'kitabu_yetu')::subscription_product;

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
    primary_objective, meeting_frequency, meeting_day, meeting_time,
    signup_product
  ) VALUES (
    v_group_name, v_group_type, v_phone, v_email,
    'pending_verification', v_group_code, v_creator_role,
    v_county_id, v_sub_county_text, v_ward_text,
    v_county_name, v_village_estate,
    v_primary_objective, v_meeting_frequency, v_meeting_day, v_meeting_time,
    v_product
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

  -- Created for BOTH products: this is where the SMS credit balance lives, and
  -- Chama Reminder is entirely SMS.
  INSERT INTO billing_accounts (group_id) VALUES (v_group_id);

  -- No subscription is created here any more (migration 139). Every plan is
  -- paid, so signup cannot hand out an ACTIVE one: this used to insert
  -- starter/active at monthly_fee 0, which was the free tier. A new group now
  -- holds no subscription until it pays, and assertSubscriptionActive keeps it
  -- out of everything except sign-in and billing until then.
  --
  -- Deliberately no 'expired' placeholder row either: a group that has never
  -- paid has never had a plan, and an expired row would give the billing page
  -- a plan_type to display as though it were once entitled.
  --
  -- billing_accounts above is still created, so SMS credit balances and
  -- top-ups have somewhere to live the moment the group does pay.

  -- Migration 140: only a Kitabu Yetu signup gets a general ledger. A Chama
  -- Reminder group is a communication product -- it has no contributions,
  -- loans or journals to post -- and the route-level entitlement gate keeps it
  -- out of every accounting surface. If it later buys Kitabu Yetu,
  -- billingService seeds the chart of accounts at activation time, which is
  -- why this function is no longer the only caller of the seeder.
  IF v_product = 'kitabu_yetu' THEN
    PERFORM seed_chart_of_accounts(v_group_id);
  END IF;

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
    'group_role',     v_group_role,
    'signup_product', v_product
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.register_group(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_group(JSONB) TO postgres;

-- register_group() seeds a new group's chart of accounts via
-- seed_chart_of_accounts() (migration 140), not a hardcoded INSERT — so the
-- 4006 addition has to land here too, or every group created after this
-- migration keeps missing it despite the backfill above covering existing
-- groups. (Discovered live: production's seed_chart_of_accounts() was still
-- missing 4006 even though register_group() itself had already been
-- corrected out-of-band — see the header comment above.)
CREATE OR REPLACE FUNCTION public.seed_chart_of_accounts(p_group_id uuid)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO accounts (group_id, account_code, name, type, is_system) VALUES
    (p_group_id, '1001', 'Cash and M-Pesa',          'asset',     true),
    (p_group_id, '1002', 'Bank Account',              'asset',     true),
    (p_group_id, '1101', 'Loans Receivable',          'asset',     true),
    (p_group_id, '1201', 'Fixed Assets',              'asset',     true),
    (p_group_id, '2001', 'Accounts Payable',          'liability', true),
    (p_group_id, '2101', 'Member Savings',            'liability', true),
    (p_group_id, '3001', 'Member Equity',             'equity',    true),
    (p_group_id, '3101', 'Retained Surplus',          'equity',    true),
    (p_group_id, '4001', 'Member Contributions',      'income',    true),
    (p_group_id, '4002', 'Interest Income — Loans',   'income',    true),
    (p_group_id, '4003', 'Registration Fees',         'income',    true),
    (p_group_id, '4004', 'Other Income',              'income',    true),
    (p_group_id, '4006', 'Changi$ha Donations',       'income',    true),
    (p_group_id, '5001', 'Administrative Expenses',   'expense',   true),
    (p_group_id, '5002', 'SMS Expenses',              'expense',   true),
    (p_group_id, '5003', 'Platform Subscription',     'expense',   true),
    (p_group_id, '5004', 'Loan Write-offs',           'expense',   true)
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
$function$;
