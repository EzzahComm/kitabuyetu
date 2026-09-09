-- =============================================================================
-- 140: Chama Reminder registration — product-aware signup, no GL for SMS-only
--
-- Phase 4 of the Chama Reminder rollout (docs/chama-reminder/). Migration 127
-- added subscriptions.product and taught register_group() to parse a `product`
-- payload key, then deliberately left the variable unused with a note that the
-- Phase 4 portal would need it. This is that phase. Four changes.
--
-- 1. groups.signup_product. Load-bearing, not decorative: since migration 139 a
--    brand-new group holds NO subscription at all, so subscriptions cannot
--    answer "what did this group sign up for". Without this column a Chama
--    Reminder registrant who closes the tab and signs back in tomorrow lands on
--    the locked Kitabu Yetu dashboard, quoting Kitabu Yetu prices, with no way
--    back to the product they came for. This column is what makes the
--    signup → pay loop closable for a standalone signup.
--
--    It records intent, not entitlement. What a group may actually USE is still
--    decided solely by its active subscriptions (lib/auth/subscription-gate.ts).
--    A caller can therefore set signup_product freely and gain nothing by it --
--    they still have to pay for whatever they want to use -- but they will get
--    a group with no chart of accounts, which change 4 below makes self-healing
--    the moment they buy Kitabu Yetu.
--
-- 2. seed_chart_of_accounts(uuid). The 16-account INSERT lifted verbatim out of
--    register_group() so both signup and a later Kitabu Yetu purchase can call
--    it. Idempotent via the existing accounts_code_unique (group_id,
--    account_code) constraint, so calling it on a group that already has a
--    chart of accounts is a no-op rather than a duplicate-key error.
--
-- 3. register_group() branches on v_product. The body below is migration 139's
--    live definition with exactly two edits -- signup_product added to the
--    groups INSERT, and the inline accounts INSERT replaced by a guarded
--    PERFORM -- so this stays a faithful replacement rather than a rewrite.
--
--    The predicate is positive (= 'kitabu_yetu'), not negative
--    (<> 'chama_reminder'): a future third product must opt IN to a general
--    ledger rather than silently inherit one.
--
--    Nothing else is skipped for a Chama Reminder signup. billing_accounts in
--    particular MUST still be created -- it holds the SMS credit balance, and
--    Chama Reminder is entirely SMS.
--
-- 4. messaging.view. A read permission for the messaging surface, which has
--    never had one: GET /api/v1/sms/usage and /sms/balance gate on
--    withRole('treasurer'), which excludes the secretary -- the role that in
--    practice does the messaging and already holds messaging.send. Seeded to
--    secretary/treasurer/chairperson, additive and monotonic, same pattern as
--    migrations 110/112/113. Not Chama-Reminder-specific; it fixes the existing
--    Kitabu Yetu SMS Centre too.
--
-- CREATE OR REPLACE FUNCTION resets privileges to default, which has silently
-- re-opened a PostgREST hole on this project twice (migrations 126 and 136).
-- The grants below restore exactly what the live functions had -- service_role
-- and app_tenant -- and nothing is granted to anon or authenticated.
-- =============================================================================

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS signup_product subscription_product NOT NULL DEFAULT 'kitabu_yetu';

COMMENT ON COLUMN public.groups.signup_product IS
  'Which product this group registered for. Records intent only -- entitlement '
  'is decided by active subscriptions. Needed because since migration 139 a new '
  'group has no subscription row until it pays.';

-- Every existing group predates Chama Reminder signup, so the DEFAULT is
-- already correct for all of them and no backfill is required.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The chart of accounts, extracted so it can be seeded later as well.
-- ─────────────────────────────────────────────────────────────────────────────

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
    (p_group_id, '5001', 'Administrative Expenses',   'expense',   true),
    (p_group_id, '5002', 'SMS Expenses',              'expense',   true),
    (p_group_id, '5003', 'Platform Subscription',     'expense',   true),
    (p_group_id, '5004', 'Loan Write-offs',           'expense',   true)
  ON CONFLICT ON CONSTRAINT accounts_code_unique DO NOTHING;
$function$;

COMMENT ON FUNCTION public.seed_chart_of_accounts(uuid) IS
  'Seeds the 16 system accounts for a Kitabu Yetu group. Idempotent -- safe to '
  'call on a group that already has them, which is what makes the Chama '
  'Reminder → Kitabu Yetu upgrade path work.';

REVOKE ALL ON FUNCTION public.seed_chart_of_accounts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_chart_of_accounts(uuid) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.seed_chart_of_accounts(uuid) TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. register_group() — migration 139's body, product-aware.
-- ─────────────────────────────────────────────────────────────────────────────

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

-- Restore the grants CREATE OR REPLACE just dropped. Matches the live ACL
-- exactly (postgres owner, service_role, app_tenant). anon/authenticated are
-- explicitly revoked rather than merely omitted: this function is SECURITY
-- DEFINER and creates groups, so reachability via PostgREST would let any
-- self-registered Supabase Auth user create groups directly.
REVOKE ALL ON FUNCTION public.register_group(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_group(jsonb) TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001,
-- scripts/ops/create-app-tenant-role.sql), so a plain fresh replay -- CI's
-- base "Tenant Isolation" job included -- has no such role at this point and
-- a bare GRANT aborts the whole migration. Same guard, and the same reason,
-- as migrations 133 and 139.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.register_group(jsonb) TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. messaging.view — the read half of the messaging permission set.
--
-- Additive and monotonic (array_agg(DISTINCT ...)), so re-running is a no-op
-- and no role loses anything. Granted to the three officer roles that can
-- already send or manage messaging; a plain member still cannot read group
-- SMS usage.
-- ─────────────────────────────────────────────────────────────────────────────

UPDATE public.roles
SET permissions = (
  SELECT array_agg(DISTINCT p)
  FROM unnest(permissions || ARRAY['messaging.view']) AS p
)
WHERE group_id IS NULL AND code IN ('secretary', 'treasurer', 'chairperson');
