-- =============================================================================
-- 141: SMS credit ledger — append-only audit trail for every balance movement
--
-- Phase 1 of docs/audits/SMS_MONETIZATION_AUDIT_2026-08.md, per Decision C:
-- ship the audit trail FIRST and move the source of truth later. The balance
-- column is read under FOR UPDATE on the hot path by reserve_sms_credits;
-- turning it into a live aggregate is a correctness and performance change to
-- the most concurrency-sensitive code in the SMS stack, and it should not be
-- made until a ledger has been proven in production to agree with it.
--
-- So this migration is deliberately INERT: it records, it does not decide.
-- Nothing reads the ledger to authorise a send. If every line of it were wrong,
-- no customer would be affected — which is exactly the property that makes it
-- safe to ship before the reconciliation has ever run.
--
-- WHAT COUNTS AS A LEDGER EVENT. Only movements that change what a payer OWNS:
-- purchase, consume, refund, adjustment, expiry. Reserve and release are
-- deliberately NOT entries — they shuffle money between `sms_credits` and
-- `reserved_sms_credits` on the same account and net to zero, so recording them
-- would make the ledger disagree with the balance it is supposed to verify.
-- This matches the spec's own §5 example, which lists purchases and
-- consumption and no reservations.
--
-- OPENING BALANCES ARE SEEDED. A ledger that starts empty against non-zero
-- balances can never reconcile, so every account holding credits today gets one
-- `adjustment` entry for its current balance. Without this the whole exercise
-- proves nothing.
--
-- ALSO DROPS TWO DEAD MONEY FUNCTIONS — see §4 at the foot of this file.
-- =============================================================================

CREATE TYPE sms_ledger_entry_type AS ENUM (
  'purchase',    -- credits bought (M-Pesa top-up, manual credit)
  'consume',     -- messages actually charged for, after provider acceptance
  'refund',      -- credits returned for something already charged
  'adjustment',  -- ops correction, or an opening balance
  'expiry'       -- credits lapsed under a future expiry policy (unused today)
);

CREATE TABLE sms_credit_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which wallet moved. Decision A kept groups and organizations on separate
  -- wallets, so the ledger carries the same two-payer shape rather than
  -- flattening them into one nullable owner column.
  payer_type      TEXT NOT NULL CHECK (payer_type IN ('group', 'organization')),
  group_id        UUID REFERENCES groups (id)        ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations (id) ON DELETE CASCADE,

  entry_type      sms_ledger_entry_type NOT NULL,

  -- SIGNED money delta applied to that account's `sms_credits`. Positive for
  -- purchase/refund, negative for consume/expiry, either for adjustment.
  -- NUMERIC(14,4) not (14,2): a consume can be a fraction of a shilling at
  -- sub-unit rates, and rounding here would silently break reconciliation.
  amount          NUMERIC(14,4) NOT NULL,

  -- The portion covered by the bundled monthly allowance, which consumes
  -- messages WITHOUT moving money. Kept out of `amount` on purpose: `amount`
  -- has to match the balance movement exactly for reconciliation to mean
  -- anything, and allowance sends move no balance.
  allowance_amount NUMERIC(14,4) NOT NULL DEFAULT 0,

  -- Balance immediately after this entry, when the writer knows it. Advisory
  -- only — reconciliation sums `amount`, it does not trust this.
  balance_after   NUMERIC(14,2),

  reference_type  VARCHAR(50),
  reference_id    UUID,
  payment_id      UUID REFERENCES payments (id) ON DELETE SET NULL,
  created_by      UUID REFERENCES members (id)  ON DELETE SET NULL,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exactly one owner, matching payer_type. Without this a row could name both
  -- wallets and be counted twice by reconciliation.
  CONSTRAINT sms_ledger_payer_shape CHECK (
    (payer_type = 'group'        AND group_id IS NOT NULL AND organization_id IS NULL)
    OR
    (payer_type = 'organization' AND organization_id IS NOT NULL AND group_id IS NULL)
  )
);

COMMENT ON TABLE sms_credit_ledger IS
  'Append-only record of every SMS credit movement. Audit trail only — nothing '
  'reads it to authorise a send. Reserve/release are not entries: they net to '
  'zero against the same account.';

CREATE INDEX idx_sms_ledger_group ON sms_credit_ledger (group_id, created_at DESC)
  WHERE group_id IS NOT NULL;
CREATE INDEX idx_sms_ledger_org ON sms_credit_ledger (organization_id, created_at DESC)
  WHERE organization_id IS NOT NULL;
CREATE INDEX idx_sms_ledger_type ON sms_credit_ledger (entry_type, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Append-only enforcement.
--
-- "Never silently modify the balance; every change must have an immutable
-- transaction record" (§5). A record that can be edited is not evidence, so the
-- immutability is enforced by the database rather than by convention — same
-- shape as reminder_dispatch_log's own append-only trigger (migration 106).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sms_ledger_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION 'sms_credit_ledger is append-only (attempted % on %)', TG_OP, OLD.id
    USING ERRCODE = '42501';
END;
$function$;

CREATE TRIGGER sms_ledger_no_update
  BEFORE UPDATE OR DELETE ON sms_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION public.sms_ledger_immutable();

ALTER TABLE sms_credit_ledger ENABLE ROW LEVEL SECURITY;

-- Mirrors billing_accounts_all: a group sees its own rows, super_admin sees
-- all. Organization rows are readable by the platform roles only — the tenant
-- axis has no organization session context.
CREATE POLICY sms_credit_ledger_select ON sms_credit_ledger
  FOR SELECT
  USING (
    (SELECT is_super_admin())
    OR (group_id IS NOT NULL AND group_id = (SELECT app_current_group_id()))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The single append point.
--
-- SECURITY DEFINER so callers that already hold the balance row locked can
-- record without needing their own write grant on the ledger, and so a tenant
-- session cannot forge an entry directly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sms_ledger_append(
  p_payer_type       TEXT,
  p_group_id         UUID,
  p_organization_id  UUID,
  p_entry_type       sms_ledger_entry_type,
  p_amount           NUMERIC,
  p_allowance_amount NUMERIC DEFAULT 0,
  p_balance_after    NUMERIC DEFAULT NULL,
  p_reference_type   VARCHAR DEFAULT NULL,
  p_reference_id     UUID    DEFAULT NULL,
  p_payment_id       UUID    DEFAULT NULL,
  p_created_by       UUID    DEFAULT NULL,
  p_notes            TEXT    DEFAULT NULL
)
 RETURNS UUID
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id UUID;
BEGIN
  -- A zero-value movement is not an event. Recording it would bury the real
  -- ones in noise without changing any sum.
  IF COALESCE(p_amount, 0) = 0 AND COALESCE(p_allowance_amount, 0) = 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO sms_credit_ledger (
    payer_type, group_id, organization_id, entry_type,
    amount, allowance_amount, balance_after,
    reference_type, reference_id, payment_id, created_by, notes
  ) VALUES (
    p_payer_type,
    CASE WHEN p_payer_type = 'group'        THEN p_group_id        END,
    CASE WHEN p_payer_type = 'organization' THEN p_organization_id END,
    p_entry_type,
    COALESCE(p_amount, 0), COALESCE(p_allowance_amount, 0), p_balance_after,
    p_reference_type, p_reference_id, p_payment_id, p_created_by, p_notes
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.sms_ledger_append(
  TEXT, UUID, UUID, sms_ledger_entry_type, NUMERIC, NUMERIC, NUMERIC,
  VARCHAR, UUID, UUID, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sms_ledger_append(
  TEXT, UUID, UUID, sms_ledger_entry_type, NUMERIC, NUMERIC, NUMERIC,
  VARCHAR, UUID, UUID, UUID, TEXT
) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sms_ledger_append('
         || 'TEXT, UUID, UUID, sms_ledger_entry_type, NUMERIC, NUMERIC, NUMERIC, '
         || 'VARCHAR, UUID, UUID, UUID, TEXT) TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Opening balances.
--
-- Seeded BEFORE settle is instrumented, so the ledger's very first sum already
-- equals the live balance and every later entry is a delta on a known-good
-- starting point.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO sms_credit_ledger (payer_type, group_id, entry_type, amount, balance_after, notes)
SELECT 'group', group_id, 'adjustment', sms_credits, sms_credits,
       'Opening balance at ledger introduction (migration 141)'
FROM billing_accounts
WHERE sms_credits <> 0;

INSERT INTO sms_credit_ledger (payer_type, organization_id, entry_type, amount, balance_after, notes)
SELECT 'organization', organization_id, 'adjustment', sms_credits, sms_credits,
       'Opening balance at ledger introduction (migration 141)'
FROM organization_billing_accounts
WHERE sms_credits <> 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Record consumption from the settle path.
--
-- Migration 136's live definition with ONE addition: a sms_ledger_append call
-- for the consumed portion. Everything else is byte-for-byte the same, so this
-- stays a faithful replacement rather than a rewrite.
--
-- Only `consume` is recorded. `release` returns a reservation and moves no
-- money, so it is not a ledger event (see the header).
--
-- The amount recorded is the PAID portion — (credits - allowance) for a group —
-- because that is exactly what the UPDATE below subtracts from `sms_credits`.
-- The allowance-covered portion rides along in allowance_amount so the record
-- is complete without breaking the reconciliation sum.
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
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('payers', v_settled, 'credits', v_total, 'outcome', p_outcome);
END;
$function$;

-- Restore what CREATE OR REPLACE just dropped. Migration 136 exists purely
-- because this reset re-opened a PostgREST hole on the sibling function, twice.
REVOKE ALL ON FUNCTION public.settle_sms_credit_reservation(uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(uuid[], text) TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.settle_sms_credit_reservation(uuid[], text) TO app_tenant';
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Reconciliation.
--
-- The whole point of Phase 1: prove the ledger agrees with the balance column
-- before anything is allowed to depend on it. `drift` must be 0 for every row.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW vw_sms_credit_reconciliation AS
SELECT 'group'::TEXT   AS payer_type,
       ba.group_id     AS payer_id,
       ba.sms_credits  AS balance,
       COALESCE(l.ledger_total, 0) AS ledger_total,
       ba.sms_credits - COALESCE(l.ledger_total, 0) AS drift
FROM billing_accounts ba
LEFT JOIN (
  SELECT group_id, SUM(amount) AS ledger_total
  FROM sms_credit_ledger WHERE payer_type = 'group' GROUP BY group_id
) l ON l.group_id = ba.group_id
UNION ALL
SELECT 'organization',
       oba.organization_id,
       oba.sms_credits,
       COALESCE(l.ledger_total, 0),
       oba.sms_credits - COALESCE(l.ledger_total, 0)
FROM organization_billing_accounts oba
LEFT JOIN (
  SELECT organization_id, SUM(amount) AS ledger_total
  FROM sms_credit_ledger WHERE payer_type = 'organization' GROUP BY organization_id
) l ON l.organization_id = oba.organization_id;

COMMENT ON VIEW vw_sms_credit_reconciliation IS
  'Ledger vs balance-column drift per payer. Every row should read drift = 0; '
  'a non-zero row means a balance moved without a ledger entry.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Drop two dead money functions.
--
-- Both mutate SMS balances and BOTH ARE UNREACHABLE: no TypeScript caller, and
-- no other database function references either (verified against production).
-- The live paths are reserve_sms_credits + settle_sms_credit_reservation.
--
--   deduct_sms_credits(uuid, numeric)          — the pre-reservation debit path,
--     superseded by migration 123. Held EXECUTE for PUBLIC *and* authenticated,
--     i.e. reachable over PostgREST by any self-registered Supabase Auth user.
--     Not exploitable today — it is SECURITY INVOKER, so billing_accounts' RLS
--     applies and app_current_group_id() is NULL for such a caller — but it is
--     a money-mutating function sitting on the exact surface that produced two
--     prior incidents (migrations 126 and 136), and one careless
--     CREATE OR REPLACE ... SECURITY DEFINER away from being real.
--
--   debit_organization_sms_credits(...)        — the organization equivalent,
--     superseded by the payer_type='organization' branch of reserve/settle.
--     Only surviving references anywhere are two code COMMENTS.
--
-- Dropping beats leaving them: an unreachable function cannot be covered by
-- tests, so nothing would catch it regaining a dangerous grant.
-- ─────────────────────────────────────────────────────────────────────────────

-- Signatures verified against production rather than guessed, so these DROPs
-- name exactly what exists and cannot silently no-op on a typo.
DROP FUNCTION IF EXISTS public.deduct_sms_credits(p_group_id uuid, p_credits numeric);
DROP FUNCTION IF EXISTS public.debit_organization_sms_credits(p_organization_id uuid, p_group_id uuid, p_message_count integer);
