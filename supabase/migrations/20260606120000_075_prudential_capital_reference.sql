-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260606120000  name: 075_prudential_capital_reference
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

-- 075 — Prudential capital reference data (Phase 5)
CREATE TABLE IF NOT EXISTS public.governance_risk_weights (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class    text    NOT NULL,
  risk_weight    numeric NOT NULL,
  provision_rate numeric NOT NULL DEFAULT 0,
  effective_from date    NOT NULL DEFAULT CURRENT_DATE
);
CREATE INDEX IF NOT EXISTS idx_gov_risk_weights_class
  ON public.governance_risk_weights (asset_class, effective_from DESC);

ALTER TABLE public.governance_risk_weights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS gov_risk_weights_select ON public.governance_risk_weights;
CREATE POLICY gov_risk_weights_select ON public.governance_risk_weights
  FOR SELECT USING (true);

INSERT INTO public.governance_risk_weights (asset_class, risk_weight, provision_rate)
SELECT v.asset_class, v.risk_weight, v.provision_rate
FROM (VALUES
  ('cash',        0.0, 0.00),
  ('bank',        0.2, 0.00),
  ('fixed_asset', 1.0, 0.00),
  ('loan_active', 1.0, 0.01),
  ('loan_par30',  1.0, 0.35),
  ('loan_npl',    1.5, 1.00)
) AS v(asset_class, risk_weight, provision_rate)
WHERE NOT EXISTS (SELECT 1 FROM public.governance_risk_weights);

INSERT INTO public.accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '1003', 'Deposit Protection Fund', 'asset', true FROM public.groups g
ON CONFLICT (group_id, account_code) DO NOTHING;

INSERT INTO public.accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '1109', 'Loan Loss Provision', 'asset', true FROM public.groups g
ON CONFLICT (group_id, account_code) DO NOTHING;

INSERT INTO public.accounts (group_id, account_code, name, type, is_system)
SELECT g.id, '3102', 'Statutory Reserve', 'equity', true FROM public.groups g
ON CONFLICT (group_id, account_code) DO NOTHING;

CREATE OR REPLACE FUNCTION public.register_group(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
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
    v_group_role,
    'active'
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
    (v_group_id, '1003', 'Deposit Protection Fund',   'asset',     true),
    (v_group_id, '1101', 'Loans Receivable',          'asset',     true),
    (v_group_id, '1109', 'Loan Loss Provision',       'asset',     true),
    (v_group_id, '1201', 'Fixed Assets',              'asset',     true),
    (v_group_id, '2001', 'Accounts Payable',          'liability', true),
    (v_group_id, '2101', 'Member Savings',            'liability', true),
    (v_group_id, '3001', 'Member Equity',             'equity',    true),
    (v_group_id, '3101', 'Retained Surplus',          'equity',    true),
    (v_group_id, '3102', 'Statutory Reserve',         'equity',    true),
    (v_group_id, '4001', 'Member Contributions',      'income',    true),
    (v_group_id, '4002', 'Interest Income - Loans',   'income',    true),
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
$function$;
