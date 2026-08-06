-- ─────────────────────────────────────────────────────────────────────────────
-- 123: SMS credit reservation + send attribution
--
-- Phase 2a of docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md, following
-- SMS_MESSAGING_AUDIT_2026-08.md. Three things this enables:
--
-- WHY RESERVATION
--   Credits are debited up-front today and never refunded (audit H5), so a
--   provider rejection burns them. Worse, reminder_dispatch_log treats 'failed'
--   as non-terminal and retries next cron — so debit-on-attempt charges again
--   every cycle. A reserve → consume/release cycle makes a failed send cost
--   nothing and makes retries safe by construction, which is the actual reason
--   this is a reservation and not a debit-plus-refund.
--
-- WHY ATTRIBUTION
--   sms_usage_logs cannot currently say who a message was for, what kind of
--   message it was, or what business action caused it. member_id /
--   notification_type / correlation_id close that.
--
-- WHY group_id BECOMES NULLABLE
--   Three OTP paths (password reset, group verification, org staff invite)
--   send real SMS today with no log row at all. Two of them have no group:
--   password-reset resolves only a members.id, and organization_invitations
--   has no group_id column. Logging them is impossible while group_id is
--   NOT NULL, so it is relaxed and a third payer_type ('platform') is added.
--
-- SHAPE — mirrors migration 066's disbursement spine, deliberately:
--   aggregate earmark on the balance row (billing_accounts.reserved_sms_credits,
--   cf. accounts.reserved_amount) + the existing business row as the per-item
--   ticket (sms_usage_logs, cf. disbursement_requests).
--     available = sms_credits - reserved_sms_credits
--
-- WHAT THIS MIGRATION DOES NOT DO
--   No new table — every column here hangs off a row that already exists 1:1
--   per message. That is a deliberate choice, not an oversight: a new table
--   would have to be added to scripts/clear-tenant-data.sql's TRUNCATE list,
--   which EVERY integration test executes via __tests__/integration/helpers/
--   cleanup.ts. Please do not "helpfully" normalise this into a table.
--   No bundled per-plan allowance and no calendar-month reset (that is Phase
--   2b); no new permission string; no backfill of historical rows.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Attribution + reservation columns ───────────────────────────────────
--
-- Every column is nullable or defaulted. This is load-bearing, not tidiness:
-- notifications.service.ts's writeSmsLog() wraps its INSERT in a catch that
-- only logs, so a column that broke its explicit column list would silently
-- stop recording sends rather than raising.

ALTER TABLE sms_usage_logs
  ADD COLUMN member_id         UUID REFERENCES members(id) ON DELETE SET NULL,
  ADD COLUMN notification_type VARCHAR(50),
  ADD COLUMN correlation_id    UUID,
  ADD COLUMN channel           VARCHAR(20)   NOT NULL DEFAULT 'sms',
  ADD COLUMN credits_reserved  NUMERIC(8,4)  NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  ADD COLUMN billing_state     VARCHAR(12)   NOT NULL DEFAULT 'none',
  ADD COLUMN reserved_at       TIMESTAMPTZ,
  ADD COLUMN settled_at        TIMESTAMPTZ;

ALTER TABLE sms_usage_logs
  ADD CONSTRAINT sms_usage_billing_state_valid
  CHECK (billing_state IN ('none', 'reserved', 'consumed', 'released'));

COMMENT ON COLUMN sms_usage_logs.member_id IS
  'Recipient member, when known. Null for raw-phone sends (custom_phones campaigns, OTP to an unregistered number).';
COMMENT ON COLUMN sms_usage_logs.notification_type IS
  'What kind of message this was (loan_due, auth_otp, campaign, ...). Free text like reference_type — deliberately not a PG enum, so adding a message type needs no migration.';
COMMENT ON COLUMN sms_usage_logs.correlation_id IS
  'Groups every row produced by one business action across channels and retries.';
COMMENT ON COLUMN sms_usage_logs.credits_reserved IS
  'Credits currently earmarked for this message. Moves to credits_deducted on consume, or back to zero on release. See billing_state.';
COMMENT ON COLUMN sms_usage_logs.billing_state IS
  'none = unbilled/platform-funded; reserved = earmarked, provider not yet called; consumed = earmark converted to a real debit; released = dispatch failed, funds returned.';

-- ─── 2. Nullable group_id + the 'platform' payer ────────────────────────────

-- Assert the existing rows all satisfy the new consistency rule before we
-- swap the constraint, in the style of migrations 115/117. At authoring time
-- production held 270 rows, all payer_type='group' with a non-null group_id.
DO $$
DECLARE
  v_bad INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_bad
  FROM sms_usage_logs
  WHERE payer_type NOT IN ('group', 'organization')
     OR group_id IS NULL;

  IF v_bad > 0 THEN
    RAISE EXCEPTION 'migration 123: % sms_usage_logs row(s) violate the new payer consistency rule', v_bad;
  END IF;
END $$;

ALTER TABLE sms_usage_logs ALTER COLUMN group_id DROP NOT NULL;

COMMENT ON COLUMN sms_usage_logs.group_id IS
  'Null only for payer_type=''platform'' (auth/OTP sends that belong to no group). Tenant RLS keys on group_id, and NULL = <uuid> is NULL, so platform rows are invisible to every tenant and visible only to super_admin — the correct outcome for auth-code audit rows.';

ALTER TABLE sms_usage_logs DROP CONSTRAINT sms_usage_payer_type_valid;
ALTER TABLE sms_usage_logs
  ADD CONSTRAINT sms_usage_payer_type_valid
  CHECK (payer_type IN ('group', 'organization', 'platform'));

ALTER TABLE sms_usage_logs DROP CONSTRAINT sms_usage_payer_consistent;
ALTER TABLE sms_usage_logs
  ADD CONSTRAINT sms_usage_payer_consistent CHECK (
       (payer_type = 'group'        AND payer_organization_id IS NULL     AND group_id IS NOT NULL)
    OR (payer_type = 'organization' AND payer_organization_id IS NOT NULL AND group_id IS NOT NULL)
    -- A platform-funded send can never carry a charge. This is deliberately a
    -- schema invariant rather than a code convention: it means a future change
    -- that turns billing on globally fails at the database, instead of locking
    -- a user out of their own password reset at 2am because their group ran
    -- out of SMS credits.
    OR (payer_type = 'platform'     AND payer_organization_id IS NULL
        AND credits_deducted = 0 AND credits_reserved = 0)
  );

-- ─── 3. Aggregate earmark on the balance rows ───────────────────────────────
--
-- No CHECK (reserved_sms_credits <= sms_credits), matching accounts.
-- reserved_amount which only checks >= 0: a cross-column check would make a
-- legitimate admin balance correction fail against an in-flight reservation.

ALTER TABLE billing_accounts
  ADD COLUMN reserved_sms_credits   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (reserved_sms_credits >= 0),
  ADD COLUMN low_balance_notified_at TIMESTAMPTZ;

ALTER TABLE organization_billing_accounts
  ADD COLUMN reserved_sms_credits   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (reserved_sms_credits >= 0),
  ADD COLUMN low_balance_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN billing_accounts.reserved_sms_credits IS
  'Credits earmarked by in-flight sends. available = sms_credits - reserved_sms_credits. Mirrors accounts.reserved_amount (migration 066).';
COMMENT ON COLUMN billing_accounts.low_balance_notified_at IS
  'Last time a low-balance alert was raised. Suppresses repeats for 24h; cleared on top-up so the alert re-arms on recovery.';

-- ─── 4. Indexes ─────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sms_usage_reservation_open
  ON sms_usage_logs (reserved_at) WHERE billing_state = 'reserved';
CREATE INDEX IF NOT EXISTS idx_sms_usage_member
  ON sms_usage_logs (member_id, created_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_usage_correlation
  ON sms_usage_logs (correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sms_usage_notification_type
  ON sms_usage_logs (notification_type, created_at DESC) WHERE notification_type IS NOT NULL;

-- ─── 5. Reservation RPCs ────────────────────────────────────────────────────
--
-- SECURITY DEFINER for the same reason as debit_organization_sms_credits
-- (migration 051): smsService.send() bills inside the caller's RLS
-- transaction, where the actor is a group officer — a role the organization
-- billing policies deliberately do not grant on an organization's balance.
--
-- RETURNS JSONB, not RETURNS TABLE, deliberately: Phase 2b must widen the
-- result with an allowance/paid split, and widening a RETURNS TABLE requires
-- DROP FUNCTION, which breaks any in-flight deploy. `available` is computed as
-- a single expression so 2b can redefine it in one place. Precedent for the
-- JSON-return shape: start_registrant_verification (migration 103).
--
-- Errors are raised with the same SQLSTATEs debit_organization_sms_credits
-- already uses, so lib/services/messaging-billing.ts maps them in one place.

CREATE OR REPLACE FUNCTION public.reserve_sms_credits(
  p_payer_type      TEXT,
  p_group_id        UUID,
  p_organization_id UUID,
  p_count           INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_rate      NUMERIC;
  v_credits   NUMERIC;
  v_reserved  NUMERIC;
  v_available NUMERIC;
  v_total     NUMERIC;
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
    SELECT COALESCE(s.sms_rate, 0.90), ba.sms_credits, ba.reserved_sms_credits
      INTO v_rate, v_credits, v_reserved
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

  v_total     := v_rate * p_count;
  -- Phase 2b widens this expression with the bundled allowance.
  v_available := v_credits - v_reserved;

  IF v_available < v_total THEN
    RAISE EXCEPTION 'insufficient SMS credits' USING ERRCODE = '22003';
  END IF;

  IF p_payer_type = 'organization' THEN
    UPDATE organization_billing_accounts
    SET reserved_sms_credits = reserved_sms_credits + v_total, updated_at = NOW()
    WHERE organization_id = p_organization_id;
  ELSE
    UPDATE billing_accounts
    SET reserved_sms_credits = reserved_sms_credits + v_total, updated_at = NOW()
    WHERE group_id = p_group_id;
  END IF;

  RETURN jsonb_build_object(
    'rate',      v_rate,
    'total',     v_total,
    'remaining', v_available - v_total
  );
END;
$fn$;

COMMENT ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) IS
  'SECURITY DEFINER — earmarks SMS credits against a group or organization balance without debiting them. Raises 22003 insufficient / 22023 bad input or missing account / 42501 not authorized. See migration 123.';

REVOKE ALL ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_sms_credits(TEXT, UUID, UUID, INTEGER) TO authenticated;

-- Settle: convert earmarks to real debits, or return them.
--
-- `WHERE billing_state = 'reserved'` is the idempotency claim, the same
-- claim-by-UPDATE idiom disbursements.service.ts uses throughout: settling a
-- batch twice is a no-op rather than a double charge. Amounts are aggregated
-- per payer so a mixed batch settles correctly even though callers send one
-- payer at a time.

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

  -- The pre-update credits_reserved must be read in a separate CTE: UPDATE ...
  -- RETURNING yields POST-update values, so reading it from the RETURNING
  -- clause would give 0 on the release path and silently never return the
  -- earmark. `WHERE billing_state = 'reserved'` inside the claim is what makes
  -- settling the same batch twice a no-op rather than a double charge.
  FOR r IN
    WITH claimed AS (
      SELECT id,
             group_id,
             payer_organization_id AS org_id,
             payer_type,
             credits_reserved      AS amt
      FROM sms_usage_logs
      WHERE id = ANY(p_log_ids)
        AND billing_state = 'reserved'
      FOR UPDATE
    ),
    upd AS (
      UPDATE sms_usage_logs l
      SET billing_state    = CASE WHEN p_outcome = 'consume' THEN 'consumed' ELSE 'released' END,
          credits_deducted = CASE WHEN p_outcome = 'consume' THEN c.amt ELSE l.credits_deducted END,
          credits_reserved = 0,
          settled_at       = NOW(),
          updated_at       = NOW()
      FROM claimed c
      WHERE l.id = c.id
      RETURNING c.payer_type AS payer_type, c.group_id AS group_id, c.org_id AS org_id, c.amt AS amt
    )
    SELECT payer_type, group_id, org_id, SUM(amt) AS credits
    FROM upd
    GROUP BY payer_type, group_id, org_id
  LOOP
    v_settled := v_settled + 1;
    v_total   := v_total + r.credits;

    -- Both decrements are clamped at zero. This is not defensive padding — it
    -- is required for correctness of the failure path. settle() runs AFTER the
    -- provider has already accepted the message, and both sms_credits and
    -- reserved_sms_credits carry a >= 0 CHECK. If a consume were ever to drive
    -- either below zero (a stale reservation settled after the balance moved,
    -- an admin correction, drift) the UPDATE would raise 23514 with the SMS
    -- already sent, stranding the reservation — and the sweeper would then
    -- retry the same failing consume forever. Recording a clamped charge is
    -- strictly better than refusing to record a send that already happened.
    -- Verified against production: an unclamped decrement raises
    -- billing_accounts_sms_credits_check.
    IF r.payer_type = 'organization' THEN
      UPDATE organization_billing_accounts
      SET reserved_sms_credits = GREATEST(reserved_sms_credits - r.credits, 0),
          sms_credits          = CASE WHEN p_outcome = 'consume'
                                      THEN GREATEST(sms_credits - r.credits, 0) ELSE sms_credits END,
          updated_at           = NOW()
      WHERE organization_id = r.org_id;
    ELSIF r.payer_type = 'group' THEN
      UPDATE billing_accounts
      SET reserved_sms_credits = GREATEST(reserved_sms_credits - r.credits, 0),
          sms_credits          = CASE WHEN p_outcome = 'consume'
                                      THEN GREATEST(sms_credits - r.credits, 0) ELSE sms_credits END,
          updated_at           = NOW()
      WHERE group_id = r.group_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('payers', v_settled, 'credits', v_total, 'outcome', p_outcome);
END;
$fn$;

COMMENT ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT) IS
  'SECURITY DEFINER — converts reserved SMS credits into a debit (consume) or returns them (release). Idempotent: only rows still in billing_state=''reserved'' are claimed. See migration 123.';

REVOKE ALL ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(UUID[], TEXT) TO authenticated;
