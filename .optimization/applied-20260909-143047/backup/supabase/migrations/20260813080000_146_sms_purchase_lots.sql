-- =============================================================================
-- 146: SMS purchase lots — never reprice a completed purchase
--
-- Phase 4 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md (spec §4).
--
-- §4's rule: a customer who buys 5,000 credits at 0.90 and later buys 5,000 at
-- 0.80 keeps the first batch at 0.90. Nothing recalculates. `sms_credits`
-- already stores `rate_applied` per purchase, so the PRICE is preserved — what
-- is missing is which credits are LEFT from which purchase, because the balance
-- is a single pooled number that consumption decrements without reference to
-- any lot.
--
-- This adds that: each purchase carries its own remaining balance, drawn down
-- oldest-first.
--
-- THE POOLED BALANCE REMAINS AUTHORITATIVE. Lots are recorded alongside it, not
-- instead of it — `reserve_sms_credits` still gates sends on
-- billing_accounts.sms_credits and is untouched by this migration. That is the
-- same philosophy migration 141 used for the ledger, for the same reason: a bug
-- in a brand-new drawdown must not be able to refuse a send a customer has paid
-- for. Reconciliation surfaces any disagreement; a later phase can move
-- authority once the two are proven to agree in production.
--
-- WHY FIFO. Oldest-first is the only ordering that makes expiry meaningful
-- later (the oldest credits are the ones that would lapse) and the only one a
-- customer can predict. LIFO would let a cheap late purchase mask an expiring
-- early one.
-- =============================================================================

-- A LATENT BUG THIS MIGRATION HAD TO FIND. sms_credits carries a
-- trg_sms_credits_updated_at trigger running set_updated_at(), but the table
-- has no updated_at column — so ANY update to it fails with
-- `record "new" has no field "updated_at"`. It went unnoticed because the
-- table was insert-only: a purchase was written once and never touched again.
-- Drawing lots down is the first thing that ever updates a row, so the column
-- has to exist. Adding it (rather than dropping the trigger) also matches the
-- convention every other table here follows, and the rows genuinely do change
-- now. Confirmed present in production before fixing.
ALTER TABLE sms_credits
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES sms_packages (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS currency   CHAR(3) NOT NULL DEFAULT 'KES',
  -- Nullable and unused: there is no expiry POLICY yet (§4 says "if
  -- applicable", and none has been agreed). The column exists so a policy can
  -- be introduced without another table rewrite; nothing reads it today.
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  -- What is LEFT of this purchase. Same unit AND SAME SCALE as credits_added —
  -- message counts since migration 144, at 2dp.
  --
  -- The scale is load-bearing, not cosmetic: credits_added is NUMERIC(_,2), so
  -- a 4dp remaining_credits fed the identical value stores 111.1111 against a
  -- credits_added of 111.11 and instantly violates the "remainder cannot exceed
  -- the purchase" check below. Caught by that constraint on the first real
  -- top-up, which is exactly what it is for.
  ADD COLUMN IF NOT EXISTS remaining_credits NUMERIC(14,2);

COMMENT ON COLUMN sms_credits.remaining_credits IS
  'Message credits left from this specific purchase, drawn down FIFO. The '
  'pooled billing_accounts.sms_credits remains authoritative for sends; this '
  'is the per-lot record §4 needs so a completed purchase is never repriced.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill.
--
-- Written for the GENERAL case, not for production's convenient one. Prod today
-- has a single group with one lot and nothing consumed, so any rule would look
-- right there — but a fresh replay, or any other environment, can have several
-- lots with consumption spread across them.
--
-- The rule: a group has consumed (total purchased - current balance). Draw that
-- down oldest-first, so the surviving credits are the newest ones, which is
-- exactly what FIFO consumption would have produced had it existed all along.
-- ─────────────────────────────────────────────────────────────────────────────

WITH consumed AS (
  SELECT sc.group_id,
         GREATEST(SUM(sc.credits_added) - COALESCE(MAX(ba.sms_credits), 0), 0) AS to_draw
  FROM sms_credits sc
  JOIN billing_accounts ba ON ba.group_id = sc.group_id
  GROUP BY sc.group_id
),
ordered AS (
  SELECT sc.id, sc.group_id, sc.credits_added,
         -- Credits in lots strictly older than this one.
         COALESCE(SUM(sc.credits_added) OVER (
           PARTITION BY sc.group_id ORDER BY sc.created_at, sc.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS older_credits
  FROM sms_credits sc
)
UPDATE sms_credits t
SET remaining_credits = GREATEST(
      LEAST(
        o.credits_added,
        -- Whatever the drawdown has not already exhausted by the time it
        -- reaches this lot.
        o.credits_added + o.older_credits - c.to_draw
      ),
      0
    )
FROM ordered o
JOIN consumed c ON c.group_id = o.group_id
WHERE t.id = o.id;

-- Any lot not covered above (no billing account) keeps its full amount.
UPDATE sms_credits SET remaining_credits = credits_added WHERE remaining_credits IS NULL;

ALTER TABLE sms_credits
  ALTER COLUMN remaining_credits SET NOT NULL,
  ADD CONSTRAINT sms_credits_remaining_sane
    CHECK (remaining_credits >= 0 AND remaining_credits <= credits_added);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1b. Make the column tolerant of an insert that omits it.
--
-- WITHOUT THIS THERE IS NO SAFE DEPLOY ORDER, which is worse than migration
-- 144's situation rather than the same. remaining_credits is NOT NULL with no
-- default, so during any window where schema and code disagree:
--
--   old code + new schema -> INSERT omits the column -> NOT NULL violation
--   new code + old schema -> INSERT names a column that does not exist
--
-- Both break a top-up, and a top-up that fails after M-Pesa has taken the money
-- is exactly the incident migration 137 exists because of.
--
-- A DEFAULT cannot help: the right value is another column on the same row
-- (credits_added), which DEFAULT expressions cannot reference. A BEFORE INSERT
-- trigger can, so the schema now fills it in for any caller that does not — old
-- deploys, ops scripts, anything. An explicit value still wins, so the
-- application path is unchanged.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sms_credits_default_remaining()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- A fresh purchase is entirely unspent.
  IF NEW.remaining_credits IS NULL THEN
    NEW.remaining_credits := NEW.credits_added;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_sms_credits_default_remaining
  BEFORE INSERT ON sms_credits
  FOR EACH ROW EXECUTE FUNCTION public.sms_credits_default_remaining();

CREATE INDEX idx_sms_credits_fifo
  ON sms_credits (group_id, created_at)
  WHERE remaining_credits > 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FIFO drawdown.
--
-- Returns what it actually drew, which can be LESS than requested when the lots
-- and the pooled balance disagree (a manual credit straight onto
-- billing_accounts, say). Returning the shortfall rather than raising keeps
-- this incapable of failing a send: settle calls it after the provider has
-- already accepted the message.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.draw_sms_credit_lots(
  p_group_id UUID,
  p_amount   NUMERIC
)
 RETURNS NUMERIC
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_left  NUMERIC := p_amount;
  v_take  NUMERIC;
  r       RECORD;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT id, remaining_credits
    FROM sms_credits
    WHERE group_id = p_group_id AND remaining_credits > 0
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(r.remaining_credits, v_left);
    UPDATE sms_credits SET remaining_credits = remaining_credits - v_take WHERE id = r.id;
    v_left := v_left - v_take;
  END LOOP;

  RETURN p_amount - v_left;   -- what was actually drawn
END;
$function$;

REVOKE ALL ON FUNCTION public.draw_sms_credit_lots(UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.draw_sms_credit_lots(UUID, NUMERIC) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.draw_sms_credit_lots(UUID, NUMERIC) TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reconciliation, extended to lots.
--
-- Replaces the view from migration 141 (same columns, plus two). `lot_total` is
-- NULL for organizations, which have no purchase-lot table at all — they buy
-- through a negotiated rate rather than packages, and inventing lots for them
-- would be fiction.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW vw_sms_credit_reconciliation AS
SELECT 'group'::TEXT   AS payer_type,
       ba.group_id     AS payer_id,
       ba.sms_credits  AS balance,
       COALESCE(l.ledger_total, 0) AS ledger_total,
       ba.sms_credits - COALESCE(l.ledger_total, 0) AS drift,
       -- COALESCE, because a group with NO purchases has no lot rows at all and
       -- `balance - NULL` is NULL — which reads as "reconciled" to anything
       -- doing Number(row.lot_drift). A group holding manually-granted credits
       -- against zero purchases is exactly the case this column exists to
       -- surface, so it must report the full balance, not nothing.
       COALESCE(lot.lot_total, 0) AS lot_total,
       ba.sms_credits - COALESCE(lot.lot_total, 0) AS lot_drift
FROM billing_accounts ba
LEFT JOIN (
  SELECT group_id, SUM(amount) AS ledger_total
  FROM sms_credit_ledger WHERE payer_type = 'group' GROUP BY group_id
) l ON l.group_id = ba.group_id
LEFT JOIN (
  SELECT group_id, SUM(remaining_credits) AS lot_total
  FROM sms_credits GROUP BY group_id
) lot ON lot.group_id = ba.group_id
UNION ALL
SELECT 'organization',
       oba.organization_id,
       oba.sms_credits,
       COALESCE(l.ledger_total, 0),
       oba.sms_credits - COALESCE(l.ledger_total, 0),
       NULL, NULL
FROM organization_billing_accounts oba
LEFT JOIN (
  SELECT organization_id, SUM(amount) AS ledger_total
  FROM sms_credit_ledger WHERE payer_type = 'organization' GROUP BY organization_id
) l ON l.organization_id = oba.organization_id;

COMMENT ON VIEW vw_sms_credit_reconciliation IS
  'Per payer: pooled balance vs ledger sum (drift) and vs remaining purchase '
  'lots (lot_drift). Both should read 0 for a group whose credits all came '
  'from purchases; a non-zero lot_drift means credits exist that no purchase '
  'accounts for (e.g. a manual grant), which is information rather than an '
  'error. lot_total is NULL for organizations, which have no lots.';

-- Migration 142's hardening, reapplied: CREATE OR REPLACE VIEW preserves
-- options and ACL, but stating it costs nothing and this exact view was the
-- subject of a cross-tenant exposure one migration after it was created.
ALTER VIEW public.vw_sms_credit_reconciliation SET (security_invoker = on);
REVOKE ALL ON public.vw_sms_credit_reconciliation FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.vw_sms_credit_reconciliation TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT ON public.vw_sms_credit_reconciliation TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Draw lots down when credits are actually consumed.
--
-- Migration 144's live definition with ONE addition per payer branch: a
-- draw_sms_credit_lots call for the group path on consume. Everything else is
-- byte-for-byte identical, so this stays a faithful replacement.
--
-- Organizations are deliberately skipped — they have no purchase lots.
--
-- The call is made AFTER the balance UPDATE and its result is discarded: the
-- pooled balance is authoritative, and a lot drawdown that comes up short must
-- never turn a successful send into a failure. The shortfall shows up in
-- vw_sms_credit_reconciliation.lot_drift instead, which is where a human can
-- see it.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.settle_sms_credit_reservation(p_log_ids uuid[], p_outcome text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_settled INTEGER := 0;
  v_total   NUMERIC := 0;
  v_paid    NUMERIC;
  r         RECORD;
BEGIN
  IF p_outcome NOT IN ('consume', 'release') THEN
    RAISE EXCEPTION 'outcome must be consume or release, got %', p_outcome
      USING ERRCODE = '22023';
  END IF;

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
           SUM(CASE WHEN from_allowance > 0 THEN 1 ELSE 0 END) AS allowance_count
    FROM upd
    GROUP BY payer_type, group_id, org_id
  LOOP
    v_settled := v_settled + 1;
    v_total   := v_total + r.credits;

    IF r.payer_type = 'organization' THEN
      UPDATE organization_billing_accounts
      SET reserved_sms_credits = GREATEST(reserved_sms_credits - r.credits, 0),
          sms_credits          = CASE WHEN p_outcome = 'consume'
                                      THEN GREATEST(sms_credits - r.credits, 0) ELSE sms_credits END,
          updated_at           = NOW()
      WHERE organization_id = r.org_id;

      IF p_outcome = 'consume' THEN
        PERFORM sms_ledger_append(
          'organization', NULL, r.org_id, 'consume',
          -r.credits, 0,
          (SELECT sms_credits FROM organization_billing_accounts WHERE organization_id = r.org_id),
          'sms_settle', NULL, NULL, NULL, NULL
        );
      END IF;

    ELSIF r.payer_type = 'group' THEN
      v_paid := r.credits - r.allowance_amt;

      UPDATE billing_accounts
      SET reserved_sms_credits   = GREATEST(reserved_sms_credits - (r.credits - r.allowance_amt), 0),
          sms_credits            = CASE WHEN p_outcome = 'consume'
                                        THEN GREATEST(sms_credits - (r.credits - r.allowance_amt), 0)
                                        ELSE sms_credits END,
          sms_allowance_reserved = GREATEST(sms_allowance_reserved - r.allowance_count, 0),
          sms_allowance_used     = sms_allowance_used
                                    + CASE WHEN p_outcome = 'consume' THEN r.allowance_count ELSE 0 END,
          updated_at              = NOW()
      WHERE group_id = r.group_id;

      IF p_outcome = 'consume' THEN
        PERFORM sms_ledger_append(
          'group', r.group_id, NULL, 'consume',
          -v_paid, r.allowance_amt,
          (SELECT sms_credits FROM billing_accounts WHERE group_id = r.group_id),
          'sms_settle', NULL, NULL, NULL, NULL
        );

        -- Migration 146. Only the PAID portion draws a lot: an
        -- allowance-funded message consumes no purchased credit.
        PERFORM draw_sms_credit_lots(r.group_id, v_paid);
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('payers', v_settled, 'credits', v_total, 'outcome', p_outcome);
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_sms_credit_reservation(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(uuid[], text) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(uuid[], text) TO app_tenant';
  END IF;
END $do$;
