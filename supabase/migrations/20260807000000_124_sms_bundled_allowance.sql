-- ─────────────────────────────────────────────────────────────────────────────
-- 124: SMS bundled monthly allowance + billing flip
--
-- Phase 2b of docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md, Decision B
-- (§7): "bill everything, with a bundled per-plan allowance." This is the
-- mechanism that keeps the 5 live groups whole the moment notifyMember starts
-- actually charging (the code-side flip ships in this same PR, not here).
--
-- SHAPE — a second reserve/consume/release bucket, doubling migration 123's
-- shape (billing_accounts.reserved_sms_credits mirrors accounts.reserved_
-- amount; this doubles it for the allowance):
--   sms_allowance_used     — cumulative real consumption this period. Only
--                            advances on consume (permanently spent).
--   sms_allowance_reserved — earmarked, not yet settled. A release must give
--                            this back too, or a failed send permanently
--                            burns free allowance — the exact bug a plain
--                            debit-on-attempt would reintroduce for the paid
--                            side (see migration 123's own header).
--
-- UNITS — both allowance-capacity columns and the per-subscription included
-- amount are INTEGER message counts, not money. sms_allowance_included = 50
-- means "50 messages", not "KES 50 worth of messages" — tracking it in money
-- would make the remaining-allowance arithmetic silently wrong the day any
-- group's sms_rate stops being 0.9000. sms_usage_logs.credits_from_allowance
-- stays NUMERIC(8,4) (money), because it records one row's own money value,
-- and one row is exactly one message (recipient_phone is NOT NULL, 1:1) —
-- so it is always either 0 or exactly that row's own credits_reserved.
--
-- NO CROSS-COLUMN CHECK tying used+reserved to included, matching
-- reserved_sms_credits' own precedent (migration 123): a plan downgrade or
-- admin correction must not fail against an in-flight reservation.
--
-- NO PRE-MIGRATION ASSERTION BLOCK. Unlike migration 123 (which tightened an
-- existing CHECK against 270 live rows), every column here is additive with a
-- default that is semantically correct for every existing row, including any
-- row currently billing_state='reserved': that reservation was earmarked
-- under the OLD (paid-only) reserve_sms_credits, so credits_from_allowance=0
-- for it is not a stand-in value, it is the true historical fact. There is
-- nothing to assert.
--
-- ORGANIZATION BRANCH IS COMPLETELY UNCHANGED. organization_billing_accounts
-- gets no allowance columns and no new logic — organizations negotiate custom
-- rates and no notifyMember call site today is org-payer.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Allowance config on subscriptions (mirrors sms_rate's placement) ────

ALTER TABLE subscriptions
  ADD COLUMN sms_allowance_included INTEGER NOT NULL DEFAULT 50
    CHECK (sms_allowance_included >= 0);

COMMENT ON COLUMN subscriptions.sms_allowance_included IS
  'Free SMS messages included per billing period for this group''s plan. A message count, not a money value — see migration 124. DEFAULT 50 covers every existing row (all 5 production groups are plan_type=''starter'') and every future INSERT that omits it; register_group() (migration 050) sets it explicitly anyway per this codebase''s convention for money-relevant columns (cf. credits_reserved always being written explicitly despite its own DEFAULT 0).';

-- ─── 2. Allowance consumption state on billing_accounts (doubles §3 of 123) ─

ALTER TABLE billing_accounts
  ADD COLUMN sms_allowance_used     INTEGER NOT NULL DEFAULT 0 CHECK (sms_allowance_used >= 0),
  ADD COLUMN sms_allowance_reserved INTEGER NOT NULL DEFAULT 0 CHECK (sms_allowance_reserved >= 0);

COMMENT ON COLUMN billing_accounts.sms_allowance_used IS
  'Messages permanently consumed from this period''s bundled allowance. Only advances on settle(''consume''); reset to 0 by the sms_allowance_monthly_reset job on the 1st of month, 01:00 UTC. Never touched by that reset for sms_allowance_reserved — see that job''s own comment for why.';
COMMENT ON COLUMN billing_accounts.sms_allowance_reserved IS
  'Messages earmarked against the allowance by in-flight sends, not yet settled. available_allowance = sms_allowance_included - sms_allowance_used - sms_allowance_reserved. Mirrors reserved_sms_credits (migration 123) for the free-allowance bucket.';

-- ─── 3. Per-row allowance split on sms_usage_logs ───────────────────────────
--
-- Read via the same claimed-CTE pattern settle_sms_credit_reservation already
-- uses for credits_reserved — UPDATE...RETURNING gives POST-update values,
-- so this must be read pre-update from the claim, not recomputed.

ALTER TABLE sms_usage_logs
  ADD COLUMN credits_from_allowance NUMERIC(8,4) NOT NULL DEFAULT 0
    CHECK (credits_from_allowance >= 0 AND credits_from_allowance <= credits_reserved);

COMMENT ON COLUMN sms_usage_logs.credits_from_allowance IS
  'Portion of this row''s credits_reserved funded by the group''s bundled monthly allowance rather than paid credits. Always exactly 0 or exactly credits_reserved — one row is one message (recipient_phone is 1:1), so a message is never split across both buckets. See reserve_sms_credits / settle_sms_credit_reservation, migration 124.';

-- ─── 4. reserve_sms_credits — widen the group branch only ───────────────────
--
-- RETURNS JSONB (migration 123's own comment: chosen specifically so this
-- widening needs no DROP FUNCTION). Same signature, so CREATE OR REPLACE
-- preserves the existing REVOKE/GRANT — restated below anyway, defensively,
-- matching this migration's own established habit of stating grants
-- explicitly rather than relying on implicit preservation across a REPLACE.

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

    -- FOR UPDATE OF ba, never a bare FOR UPDATE: PostgreSQL rejects locking
    -- the nullable side of an outer join at parse-analysis (0A000). That was
    -- SMS_MESSAGING_AUDIT_2026-08.md C1, which broke every group-funded send
    -- for months. Carried forward verbatim.
    SELECT COALESCE(s.sms_rate, 0.90),
           COALESCE(s.sms_allowance_included, 50),
           ba.sms_credits, ba.reserved_sms_credits,
           ba.sms_allowance_used, ba.sms_allowance_reserved
      INTO v_rate, v_allowance_included,
           v_credits, v_reserved,
           v_allowance_used, v_allowance_reserved
    FROM billing_accounts ba
    LEFT JOIN subscriptions s ON s.group_id = ba.group_id AND s.status = 'active'
    WHERE ba.group_id = p_group_id
    FOR UPDATE OF ba;

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
  'SECURITY DEFINER — earmarks SMS credits (and, for group payers, bundled allowance) against a balance without debiting them. Allowance is consumed before paid credits. Raises 22003 insufficient / 22023 bad input or missing account / 42501 not authorized. See migrations 123, 124.';

REVOKE ALL ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) TO authenticated;

-- ─── 5. settle_sms_credit_reservation — route the allowance bucket too ──────

CREATE OR REPLACE FUNCTION public.settle_sms_credit_reservation(
  p_log_ids UUID[],
  p_outcome TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_settled INTEGER := 0;
  v_total   NUMERIC := 0;
  r         RECORD;
BEGIN
  IF p_outcome NOT IN ('consume', 'release') THEN
    RAISE EXCEPTION 'outcome must be consume or release, got %', p_outcome
      USING ERRCODE = '22023';
  END IF;

  -- credits_from_allowance, like credits_reserved, must be read from the
  -- claimed CTE pre-update — UPDATE...RETURNING gives post-update values,
  -- which would give 0 on the release path and silently never return the
  -- allowance earmark either.
  FOR r IN
    WITH claimed AS (
      SELECT id,
             group_id,
             payer_organization_id  AS org_id,
             payer_type,
             credits_reserved       AS amt,
             credits_from_allowance AS from_allowance
      FROM sms_usage_logs
      WHERE id = ANY(p_log_ids)
        AND billing_state = 'reserved'
      FOR UPDATE
    ),
    upd AS (
      UPDATE sms_usage_logs l
      SET billing_state          = CASE WHEN p_outcome = 'consume' THEN 'consumed' ELSE 'released' END,
          credits_deducted       = CASE WHEN p_outcome = 'consume' THEN c.amt ELSE l.credits_deducted END,
          credits_reserved       = 0,
          credits_from_allowance = 0,
          settled_at             = NOW(),
          updated_at             = NOW()
      FROM claimed c
      WHERE l.id = c.id
      RETURNING c.payer_type AS payer_type, c.group_id AS group_id, c.org_id AS org_id,
                c.amt AS amt, c.from_allowance AS from_allowance
    )
    SELECT payer_type, group_id, org_id,
           SUM(amt)            AS credits,
           SUM(from_allowance) AS allowance_amt,
           -- One row is one message and from_allowance is all-or-nothing per
           -- row (0 or the row's own credits_reserved), so counting rows
           -- where from_allowance > 0 is an exact message count — no
           -- division by rate needed, and therefore no rounding risk.
           SUM(CASE WHEN from_allowance > 0 THEN 1 ELSE 0 END) AS allowance_count
    FROM upd
    GROUP BY payer_type, group_id, org_id
  LOOP
    v_settled := v_settled + 1;
    v_total   := v_total + r.credits;

    -- Both decrements clamped at zero — unchanged rationale from migration
    -- 123: a stale reservation settling after balance drift must not raise
    -- a CHECK violation and strand the reservation with the SMS already sent.
    IF r.payer_type = 'organization' THEN
      -- Completely unchanged: r.allowance_amt/allowance_count are always 0
      -- for organization rows (reserve_sms_credits never sets from_allowance
      -- on that branch), so this is byte-for-byte migration 123's logic.
      UPDATE organization_billing_accounts
      SET reserved_sms_credits = GREATEST(reserved_sms_credits - r.credits, 0),
          sms_credits          = CASE WHEN p_outcome = 'consume'
                                      THEN GREATEST(sms_credits - r.credits, 0) ELSE sms_credits END,
          updated_at           = NOW()
      WHERE organization_id = r.org_id;
    ELSIF r.payer_type = 'group' THEN
      UPDATE billing_accounts
      SET -- Paid-side bookkeeping now uses only the paid portion of this
          -- batch (credits minus whatever came from allowance) — unchanged
          -- shape, corrected input.
          reserved_sms_credits   = GREATEST(reserved_sms_credits - (r.credits - r.allowance_amt), 0),
          sms_credits            = CASE WHEN p_outcome = 'consume'
                                        THEN GREATEST(sms_credits - (r.credits - r.allowance_amt), 0)
                                        ELSE sms_credits END,
          -- Allowance earmark always drains, on both consume and release —
          -- a release must give the allowance back too, exactly like the
          -- paid side, or a failed send permanently burns free allowance.
          sms_allowance_reserved = GREATEST(sms_allowance_reserved - r.allowance_count, 0),
          -- Allowance is only PERMANENTLY spent on consume.
          sms_allowance_used     = sms_allowance_used
                                    + CASE WHEN p_outcome = 'consume' THEN r.allowance_count ELSE 0 END,
          updated_at              = NOW()
      WHERE group_id = r.group_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('payers', v_settled, 'credits', v_total, 'outcome', p_outcome);
END;
$fn$;

COMMENT ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT) IS
  'SECURITY DEFINER — converts reserved SMS credits and/or bundled allowance into a debit (consume) or returns them (release). Idempotent: only rows still in billing_state=''reserved'' are claimed. See migrations 123, 124.';

REVOKE ALL ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT) TO authenticated;

-- ─── 6. register_group — set the allowance explicitly for new groups ───────
--
-- Migration 050 (20260710000000, applied AFTER migration 075 despite its
-- lower embedded number — application order is by filename timestamp, not
-- the label in the middle) is the currently-authoritative CREATE OR REPLACE
-- of this function; no migration after it touches the body. Full body copied
-- verbatim from 050 with exactly one change: the subscriptions INSERT now
-- sets sms_allowance_included explicitly, matching how monthly_fee/sms_rate
-- are already explicit here despite each having its own column DEFAULT (the
-- same convention credits_reserved/billing_state follow on every
-- sms_usage_logs insert elsewhere in this codebase).

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

  -- Phase 2b (migration 124): sms_allowance_included set explicitly, same
  -- convention as monthly_fee/sms_rate above despite its own column DEFAULT.
  INSERT INTO subscriptions (
    group_id, plan_type, status, started_at, monthly_fee, sms_rate, sms_allowance_included, max_members
  ) VALUES (
    v_group_id, 'starter', 'active', NOW(), 0, 0.9000, 50, NULL
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
