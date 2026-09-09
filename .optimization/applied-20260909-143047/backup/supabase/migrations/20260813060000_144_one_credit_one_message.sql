-- =============================================================================
-- 144: One credit is one message — close the SMS credit unit mismatch
--
-- A LIVE REVENUE LEAK, found while planning Phase 3 of
-- docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md.
--
-- billing_accounts.sms_credits was CREDITED in message counts and DEBITED in
-- money:
--
--   top-up  (billing.service.addSmsCredits): credits += amount_paid / rate
--           KES 100 at 0.90  ->  +111.11        ... a MESSAGE COUNT
--   send    (reserve_sms_credits):           reserved += count * rate
--           1 message at 0.90 ->  -0.90         ... MONEY
--
-- Verified against production: the only funded group paid KES 100.00,
-- rate_applied 0.9000, credits_added 111.11 — and its two settled messages
-- deducted 1.80 total, i.e. 0.90 each.
--
-- Effect: a customer who paid for 111 messages could send 123. The error
-- factor is 1/rate, so it gets WORSE as prices fall — at the 0.50 tier
-- proposed in the spec they would have received double what they paid for,
-- and the volume discount this whole project exists to introduce would have
-- amplified the leak rather than being neutral to it.
--
-- THE FIX IS TWO LINES, in the reservation split: earmark message counts
-- rather than money. Everything downstream then agrees by construction —
-- the sufficiency check compares messages to messages, reserved_sms_credits
-- holds messages, and settle subtracts the same counts it reserved.
--
-- NO BALANCE CONVERSION IS NEEDED. The stored balance was always produced by
-- the top-up path, so it is already a message count: 111.11 really does mean
-- 111 messages. This migration makes the deduction side agree with it rather
-- than moving anybody's money.
--
-- HISTORICAL ROWS ARE LEFT ALONE. sms_usage_logs rows written before today
-- carry credits_deducted in money (0.90 per message); rows after carry message
-- counts (1 per message). They are not retro-converted — rewriting historical
-- billing records to values that were never charged would be worse than a
-- documented unit change at a known date. Analytics summing credits_deducted
-- across the boundary mixes units; in practice 270 of the 286 production rows
-- predate the reservation system entirely (billing_state = 'none').
--
-- CREATE OR REPLACE resets the ACL — restored below, as always here.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.reserve_sms_credits(p_payer_type text, p_group_id uuid, p_organization_id uuid, p_count integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- MIGRATION 144 — THE FIX. These were `* v_rate`, i.e. money, while the
  -- top-up path credits MESSAGE COUNTS (amount_paid / rate). The balance was
  -- credited in messages and debited in money, so at a 0.90 rate a customer
  -- who bought 111 messages could send 123. The error factor is 1/rate, so it
  -- worsens as prices fall — at the proposed 0.50 tier they would have got
  -- double what they paid for.
  --
  -- One credit is now one message everywhere (spec §6). v_total below keeps
  -- its money meaning: it is the notional COST of the send, returned for
  -- display and logging, never subtracted from a balance.
  v_from_allowance       := v_from_allowance_count;
  v_from_paid            := v_from_paid_count;

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
    'fromAllowance',      v_from_allowance,            -- MESSAGE COUNT funded by allowance (0 for organization)
    'fromPaid',           v_from_paid,                 -- MESSAGE COUNT earmarked against paid credits
    'fromAllowanceCount', v_from_allowance_count,       -- message count funded by allowance (0 for organization)
    'fromPaidCount',      v_from_paid_count             -- message count funded by paid credits
  );
END;
$function$;


-- Restore what CREATE OR REPLACE dropped. Migration 136 exists solely because
-- this reset re-opened a PostgREST hole on this exact function once already.
REVOKE ALL ON FUNCTION public.reserve_sms_credits(text, uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_sms_credits(text, uuid, uuid, integer) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.reserve_sms_credits(text, uuid, uuid, integer) TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Correct the ledger column comment, rather than editing migration 141.
--
-- 141 said `amount` was a "signed money delta". It is whatever `sms_credits`
-- is, because vw_sms_credit_reconciliation compares the two directly — and as
-- of this migration that is a MESSAGE COUNT.
--
-- 141 is already applied to production, so it is left byte-for-byte alone:
-- an applied migration is a record of what ran, and editing one makes the file
-- disagree with the database it produced. Corrections belong in a new
-- migration, even when they are only comments.
-- ─────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.sms_credit_ledger.amount IS
  'Signed delta applied to the payer''s sms_credits. Unit is a MESSAGE COUNT '
  '(migration 144); rows written before that carry money values and are '
  'deliberately not retro-converted.';
