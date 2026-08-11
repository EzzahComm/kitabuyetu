-- ============================================================================
-- 127 — Multi-product subscriptions
--
-- Chama Reminder is a second product sold on the same platform. Until now a
-- group could hold exactly ONE active subscription (migration 005's partial
-- unique index), so "this group has Kitabu Yetu *and* Chama Reminder" was
-- structurally impossible to express. Decision A of
-- docs/chama-reminder/CHAMA_REMINDER_ARCHITECTURE_INTEGRATION.md §5 resolved
-- this in favour of a `product` column on `subscriptions` with the constraint
-- widened to one active row per (group, product) — deliberately NOT a parallel
-- chama_reminder_subscriptions table, which is the duplication that report's
-- §30 says not to do.
--
-- THE COLUMN IS THE EASY HALF. Every existing consumer was written against
-- "one active subscription per group," and the dangerous ones fail SILENTLY
-- rather than loudly once a second row exists. This migration therefore also
-- fixes the two SQL-side readers that would misbehave; the TypeScript-side
-- readers (billing.service, feature-flags.service, admin.service,
-- organization.service) are fixed in the same changeset.
--
-- NOTHING HERE CREATES A SECOND ACTIVE ROW. Every existing row is
-- kitabu_yetu, register_group() still defaults to kitabu_yetu, and no code
-- path yet inserts a chama_reminder subscription — that arrives with the
-- portal in Phase 4. The widened index is inert until then. The point of
-- landing it now is that every reader is already correct on the day the first
-- second row appears.
--
-- NO BACKFILL STATEMENT AND NO PRE-MIGRATION ASSERTION BLOCK. The new column
-- is additive with a default that is the true historical fact for every
-- existing row — every subscription ever written was a Kitabu Yetu one. This
-- is the same reasoning migration 124 documents for its own additive columns;
-- there is nothing to assert.
-- ============================================================================

-- ─── 1. The product axis ────────────────────────────────────────────────────

CREATE TYPE subscription_product AS ENUM ('kitabu_yetu', 'chama_reminder');

ALTER TABLE subscriptions
  ADD COLUMN product subscription_product NOT NULL DEFAULT 'kitabu_yetu';

COMMENT ON COLUMN subscriptions.product IS
  'Which product this subscription entitles the group to. plan_type (starter/growth/enterprise) is scoped WITHIN a product — a Chama Reminder "growth" is a different price and bundle from a Kitabu Yetu "growth", resolved by types/enums.ts''s (product, plan) tables. Deliberately not new plan_type enum values: plan_type stays a closed 3-value set that get_expired_subscriptions()''s RETURNS TABLE signature already depends on.';

-- ─── 2. One active subscription per (group, product), not per group ─────────
--
-- billingService.createStarterSubscription()'s bare `ON CONFLICT DO NOTHING`
-- (no conflict target) keeps working across this change: it fires on whatever
-- unique constraint is violated, which is now this wider one.

DROP INDEX idx_subscriptions_one_active;

CREATE UNIQUE INDEX idx_subscriptions_one_active_per_product
  ON subscriptions (group_id, product)
  WHERE status = 'active';

-- ─── 3. reserve_sms_credits — aggregate across products ─────────────────────
--
-- THE SILENT BUG THIS CLOSES. The group branch read sms_rate and
-- sms_allowance_included through `SELECT ... INTO` over a LEFT JOIN to
-- subscriptions. PL/pgSQL's SELECT INTO (without STRICT) takes the FIRST row
-- and discards the rest without raising — so the moment a group held two
-- active subscriptions, the rate and bundle it was billed at became whichever
-- row the planner happened to return first. Non-deterministic billing, no
-- error, no log line.
--
-- The rule that replaces it, per this phase's decision: SUM the bundled
-- allowances and charge MIN(sms_rate) across all active subscriptions. SMS
-- credits already live in a single per-group billing_accounts wallet, so SMS
-- pricing is a group-level fact rather than a per-subscription one; a group
-- paying for both products gets both bundles and its best entitled rate.
-- billing.service.ts's own rate quote uses the identical rule, so what the UI
-- quotes is what reserve_sms_credits actually charges.
--
-- THIS SPLITS INTO TWO STATEMENTS, and must: PostgreSQL rejects FOR UPDATE in
-- a query with aggregate functions. Locking billing_accounts first (the
-- contended row) and then reading subscriptions unlocked is exactly today's
-- behaviour anyway — C1's fix made subscriptions the un-lockable nullable side
-- of that outer join, so it has never been locked here.
--
-- Zero active subscriptions makes MIN/SUM return NULL, so the COALESCE
-- defaults preserve the old LEFT-JOIN-miss behaviour byte for byte. The
-- NOT EXISTS guard above still raises 42501 first regardless.
--
-- Same signature as migrations 123/124 (RETURNS JSONB, chosen precisely so
-- widenings need no DROP FUNCTION), so CREATE OR REPLACE preserves the
-- existing grants — restated below anyway, matching 124's own habit.

CREATE OR REPLACE FUNCTION public.reserve_sms_credits(
  p_payer_type      TEXT,
  p_group_id        UUID,
  p_organization_id UUID,
  p_count           INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rate                 NUMERIC;
  v_credits              NUMERIC;
  v_reserved             NUMERIC;
  v_available            NUMERIC;
  v_total                NUMERIC;
  -- Allowance state. Defaulted to 0 here so the organization branch — which
  -- never assigns them — flows through the shared math block below with
  -- v_allowance_remaining always 0, collapsing to exactly today's behaviour
  -- (fromAllowanceCount=0, fromPaid=v_total) without a second code path.
  v_allowance_included   INTEGER := 0;
  v_allowance_used       INTEGER := 0;
  v_allowance_reserved   INTEGER := 0;
  v_allowance_remaining  INTEGER;
  v_from_allowance_count INTEGER;
  v_from_paid_count      INTEGER;
  v_from_allowance       NUMERIC;
  v_from_paid            NUMERIC;
BEGIN
  IF p_count <= 0 THEN
    RAISE EXCEPTION 'message count must be positive' USING ERRCODE = '22023';
  END IF;

  IF p_payer_type = 'organization' THEN
    IF NOT EXISTS (
      SELECT 1 FROM organization_group_access
      WHERE organization_id = p_organization_id
        AND group_id        = p_group_id
        AND is_active
    ) THEN
      RAISE EXCEPTION 'group % has no active access under organization %',
        p_group_id, p_organization_id USING ERRCODE = '42501';
    END IF;

    SELECT oba.sms_rate, oba.sms_credits, oba.reserved_sms_credits
      INTO v_rate, v_credits, v_reserved
    FROM organization_billing_accounts oba
    WHERE oba.organization_id = p_organization_id AND oba.is_active
    FOR UPDATE;

    IF v_rate IS NULL THEN
      RAISE EXCEPTION 'organization % has no active billing account', p_organization_id
        USING ERRCODE = '22023';
    END IF;
    -- No allowance branch here, deliberately: organizations negotiate custom
    -- rates and get no bundled allowance. v_allowance_* stay at their 0
    -- DECLARE defaults.

  ELSIF p_payer_type = 'group' THEN
    IF NOT EXISTS (
      SELECT 1 FROM subscriptions WHERE group_id = p_group_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'group % has no active subscription', p_group_id
        USING ERRCODE = '42501';
    END IF;

    -- Lock the billing account on its own. billing_accounts is no longer the
    -- nullable side of an outer join here, so a plain FOR UPDATE is now legal
    -- and says what it means — the `FOR UPDATE OF ba` spelling only existed to
    -- work around the LEFT JOIN this replaces (SMS_MESSAGING_AUDIT_2026-08.md
    -- C1, which broke every group-funded send for months).
    SELECT ba.sms_credits, ba.reserved_sms_credits,
           ba.sms_allowance_used, ba.sms_allowance_reserved
      INTO v_credits, v_reserved,
           v_allowance_used, v_allowance_reserved
    FROM billing_accounts ba
    WHERE ba.group_id = p_group_id
    FOR UPDATE;

    -- Then aggregate the group's entitlements across every active product.
    -- Separate statement because FOR UPDATE and aggregates cannot coexist.
    SELECT COALESCE(MIN(s.sms_rate), 0.90),
           COALESCE(SUM(s.sms_allowance_included), 50)
      INTO v_rate, v_allowance_included
    FROM subscriptions s
    WHERE s.group_id = p_group_id
      AND s.status   = 'active';

    IF v_credits IS NULL THEN
      RAISE EXCEPTION 'group % has no billing account', p_group_id
        USING ERRCODE = '22023';
    END IF;

  ELSE
    RAISE EXCEPTION 'payer type % cannot reserve credits', p_payer_type
      USING ERRCODE = '22023';
  END IF;

  v_total := v_rate * p_count;

  -- Phase 2b: split the request between bundled allowance and paid credits.
  -- Allowance is consumed strictly before paid credits (Decision B). GREATEST
  -- floors at 0 so a plan downgrade that leaves used+reserved > included
  -- never goes negative, matching this file's clamping style throughout.
  v_allowance_remaining  := GREATEST(v_allowance_included - v_allowance_used - v_allowance_reserved, 0);
  v_from_allowance_count := LEAST(v_allowance_remaining, p_count);
  v_from_paid_count      := p_count - v_from_allowance_count;
  v_from_allowance       := v_from_allowance_count * v_rate;
  v_from_paid            := v_from_paid_count * v_rate;

  v_available := v_credits - v_reserved;

  -- Only the paid portion is gated by paid-credit availability. The
  -- allowance portion is gated only by its own remaining bucket above —
  -- it can never be blocked by a zero paid balance, which is the entire
  -- point of Decision B's bundled allowance.
  IF v_available < v_from_paid THEN
    RAISE EXCEPTION 'insufficient SMS credits' USING ERRCODE = '22003';
  END IF;

  IF p_payer_type = 'organization' THEN
    UPDATE organization_billing_accounts
    SET reserved_sms_credits = reserved_sms_credits + v_from_paid, updated_at = NOW()
    WHERE organization_id = p_organization_id;
  ELSE
    UPDATE billing_accounts
    SET reserved_sms_credits   = reserved_sms_credits + v_from_paid,
        sms_allowance_reserved = sms_allowance_reserved + v_from_allowance_count,
        updated_at              = NOW()
    WHERE group_id = p_group_id;
  END IF;

  RETURN jsonb_build_object(
    'rate',               v_rate,
    'total',              v_total,                    -- unchanged meaning: full notional cost of this reservation
    'remaining',          v_available - v_from_paid,   -- Phase 2b redefinition: remaining PAID balance, not remaining-after-full-total
    'fromAllowance',      v_from_allowance,            -- money value of the allowance-funded portion (0 for organization)
    'fromPaid',           v_from_paid,                 -- money value actually earmarked against paid credits
    'fromAllowanceCount', v_from_allowance_count,       -- message count funded by allowance (0 for organization)
    'fromPaidCount',      v_from_paid_count             -- message count funded by paid credits
  );
END;
$fn$;

COMMENT ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) IS
  'SECURITY DEFINER — earmarks SMS credits (and, for group payers, bundled allowance) against a balance without debiting them. Allowance is consumed before paid credits. A group payer''s rate and bundle aggregate across ALL its active subscriptions: MIN(sms_rate), SUM(sms_allowance_included) — see migration 127. Raises 22003 insufficient / 22023 bad input or missing account / 42501 not authorized. See migrations 123, 124, 127.';

REVOKE ALL ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) TO authenticated;

-- ─── 4. vw_organization_group_summary — one row per group, not per product ──
--
-- The LEFT JOIN to subscriptions puts sub.plan_type in the GROUP BY, so a
-- group holding two products would appear TWICE in an organization's group
-- list. Replaced with a LATERAL that can only ever return one row.
--
-- Scoped to kitabu_yetu specifically: this view is an organization's window
-- onto the savings/loan financials of groups it oversees, which is the Kitabu
-- Yetu product. An organization has no interest in whether a group also buys
-- Chama Reminder, and a NULL here (a Chama-Reminder-only group an organization
-- somehow had access to) correctly reads as "no Kitabu Yetu plan".
--
-- Column list, order and types are unchanged, which is what CREATE OR REPLACE
-- VIEW requires. security_invoker is restated rather than relied upon —
-- migration 015 set it, and losing it here would silently turn this back into
-- a definer-rights view that bypasses the caller's RLS.

CREATE OR REPLACE VIEW public.vw_organization_group_summary
WITH (security_invoker = true) AS
SELECT g.id AS group_id,
    g.name AS group_name,
    g.type AS group_type,
    g.county,
    count(DISTINCT gm.member_id) FILTER (WHERE gm.is_active) AS active_member_count,
    count(DISTINCT gm.member_id) FILTER (WHERE NOT gm.is_active) AS inactive_member_count,
    COALESCE(sum(c.amount) FILTER (WHERE c.status = 'completed'::contribution_status), 0::numeric) AS total_contributions,
    COALESCE(count(c.id) FILTER (WHERE c.status = 'completed'::contribution_status), 0::bigint) AS contribution_count,
    COALESCE(sum(l.principal_amount) FILTER (WHERE l.status = ANY (ARRAY['disbursed'::loan_status, 'active'::loan_status])), 0::numeric) AS active_loan_portfolio,
    COALESCE(count(l.id) FILTER (WHERE l.status = 'defaulted'::loan_status), 0::bigint) AS defaulted_loan_count,
    sub.plan_type AS subscription_plan,
    sub.status AS subscription_status,
    g.created_at AS group_created_at
   FROM groups g
     JOIN organization_group_access nga ON nga.group_id = g.id AND nga.organization_id = app_current_organization_id() AND nga.is_active = true
     LEFT JOIN group_members gm ON gm.group_id = g.id
     LEFT JOIN contributions c ON c.group_id = g.id
     LEFT JOIN loans l ON l.group_id = g.id
     LEFT JOIN LATERAL (
       SELECT s.plan_type, s.status
       FROM subscriptions s
       WHERE s.group_id = g.id
         AND s.status   = 'active'
         AND s.product  = 'kitabu_yetu'
       LIMIT 1
     ) sub ON true
  GROUP BY g.id, g.name, g.type, g.county, sub.plan_type, sub.status, g.created_at;

-- ─── 5. register_group — stamp the product on the subscription it creates ───
--
-- Body carried forward verbatim from migration 124 (itself carried from 050,
-- the last migration to touch the logic) with exactly three changes: a
-- v_product declaration, its parse from the payload, and the product column on
-- the subscriptions INSERT. Everything else — validation, group_code
-- allocation, the officer rows, the 16-account chart of accounts — is byte for
-- byte what it was.
--
-- The product DEFAULTS to kitabu_yetu when the payload omits it, so every
-- existing caller (app/api/v1/auth/register-group, and every test fixture) is
-- unaffected and existing signup behaviour is identical.
--
-- DELIBERATELY NOT DOING Decision C's other half yet: a chama_reminder signup
-- still gets the full chart of accounts and GL seeding. Skipping that needs a
-- Chama-Reminder-only signup flow to exercise it and a sweep of everything
-- downstream that assumes a group HAS a chart of accounts — that lands with
-- the portal in Phase 4, not here.

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

  -- Phase 2b (migration 124): sms_allowance_included set explicitly, same
  -- convention as monthly_fee/sms_rate above despite its own column DEFAULT.
  INSERT INTO subscriptions (
    group_id, product, plan_type, status, started_at, monthly_fee, sms_rate, sms_allowance_included, max_members
  ) VALUES (
    v_group_id, v_product, 'starter', 'active', NOW(), 0, 0.9000, 50, NULL
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
