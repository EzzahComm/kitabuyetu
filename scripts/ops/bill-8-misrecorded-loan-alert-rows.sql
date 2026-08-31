-- =============================================================================
-- Correct the 8 delivered-but-unbilled loan-alert rows (SMS-AUDIT-v3 G7/G6)
--
-- WHAT THESE ROWS ARE
-- Eight sms_usage_logs rows for THE FIONA'S, all 2026-08-16, all
-- billing_state='released' AND status='sent': delivered, with real distinct
-- provider_msg_ids, and charged nothing. They are four PAIRS — four members
-- who each received the same loan alert twice, two hours apart, because
-- smsService.send had no correlation-key dedup and two retry owners (the
-- trigger engine and the sms_failures cron) both re-sent. That defect is fixed
-- separately; this script only settles what it left behind.
--
-- DECISION TAKEN (user, 2026-09-01): bill ONE message per member and absorb
-- the four duplicates. The duplicate was our defect, not something the group
-- asked for, so charging for it would be charging for a bug. TextSMS billed us
-- for all eight; the platform eats four (~KES 1.40 at the 0.35 provider cost).
--
-- NOTHING IS DELETED. The four absorbed rows stay exactly as they are —
-- status='sent', billing_state='released', credits_deducted=0 — which is
-- already the accurate description of "delivered, deliberately not charged".
-- billing_state has no 'waived' value to invent, so the REASON is recorded in
-- the append-only ledger instead, where it cannot be lost.
--
-- WHY THE LEDGER AMOUNT IS ZERO
-- The group's paid balance is 0.00; this is funded from the bundled monthly
-- allowance. vw_sms_credit_reconciliation computes drift as
-- `balance - SUM(ledger.amount)` and ignores allowance_amount entirely, so an
-- allowance-funded consumption MUST carry amount=0 and allowance_amount=1 —
-- which is exactly the shape of this group's two existing consume rows.
-- Writing a non-zero amount here would manufacture drift and trip the new
-- sms_credit_reconciliation job on its first run.
--
-- PERIOD: sms_allowance_period_start is 2026-08-11, so the 08-16 sends fall in
-- the CURRENT allowance period. This is not a cross-period charge.
--
-- Run inside BEGIN ... ROLLBACK first and compare against the preview.
-- =============================================================================

DO $$
DECLARE
  v_group  UUID := '4fcd5d11-f554-4812-8090-daccca232d27';
  v_billed INT;
  v_before INT;
BEGIN
  SELECT COUNT(*) INTO v_before
  FROM sms_usage_logs
  WHERE group_id = v_group AND billing_state = 'released' AND status = 'sent';

  IF v_before <> 8 THEN
    RAISE EXCEPTION 'Expected exactly 8 released+sent rows, found % — stopping', v_before;
  END IF;

  -- Bill the FIRST send of each pair; leave the second (the duplicate) alone.
  CREATE TEMP TABLE billed ON COMMIT DROP AS
  WITH pairs AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY correlation_id ORDER BY created_at) AS rn
      FROM sms_usage_logs
     WHERE group_id = v_group AND billing_state = 'released' AND status = 'sent'
  )
  SELECT id FROM pairs WHERE rn = 1;

  UPDATE sms_usage_logs u
     SET credits_reserved       = 1,
         credits_from_allowance = 1,   -- CHECK: must be <= credits_reserved
         credits_deducted       = 1,
         billing_state          = 'consumed'
    FROM billed b
   WHERE b.id = u.id;

  GET DIAGNOSTICS v_billed = ROW_COUNT;
  IF v_billed <> 4 THEN
    RAISE EXCEPTION 'Expected to bill 4 rows, billed % — stopping', v_billed;
  END IF;

  -- Spend the allowance those four messages actually used.
  UPDATE billing_accounts
     SET sms_allowance_used = sms_allowance_used + 4,
         updated_at         = NOW()
   WHERE group_id = v_group;

  -- One consume entry per billed message, matching this group's existing
  -- allowance-funded rows (amount 0, allowance_amount 1).
  --
  -- Selected by the ids just billed, NOT by date. The first run selected
  -- `billing_state='consumed' AND created_at::date = '2026-08-16'`, which also
  -- matched a message ALREADY consumed that day that already carried its own
  -- sms_settle entry, double-recording its allowance. Corrected forward by a
  -- compensating adjustment (see the foot of this file); the fix here is to
  -- key off identity rather than a date other rows can share.
  --
  -- The waiver rationale rides on these notes. It was originally a separate
  -- zero-value 'adjustment', which sms_ledger_append refuses by design.
  PERFORM sms_ledger_append(
    'group', v_group, NULL, 'consume', 0, 1,
    (SELECT sms_credits FROM billing_accounts WHERE group_id = v_group),
    'sms_usage_log', b.id, NULL, NULL,
    'Backfill: delivered 2026-08-16 but never settled (SMS-AUDIT-v3 G7). '
    || 'Funded from the bundled allowance. The duplicate of this message, sent '
    || 'two hours later by our own retry defect, was deliberately NOT charged.'
  )
  FROM billed b;

  RAISE NOTICE 'Billed % rows; 4 duplicates absorbed and retained.', v_billed;
END
$$;

-- =============================================================================
-- WHAT WAS ACTUALLY APPLIED (2026-09-01, production)
--
-- Billing is correct: 4 rows moved released -> consumed at 1 credit each,
-- sms_allowance_used 3 -> 7, the 4 duplicates retained as sent/released, and
-- vw_sms_credit_reconciliation drift stayed 0.0000 throughout.
--
-- Two defects in the FIRST version of this script, both fixed above:
--
--  1. The ledger step selected by DATE and so also matched one message that
--     was already consumed on 2026-08-16 with its own sms_settle entry,
--     double-recording its allowance. Corrected forward by an 'adjustment'
--     with allowance_amount = -1 (reference_id a5dc55be-...), because the
--     ledger is append-only and must never be edited in place.
--
--  2. A zero-value 'adjustment' carried the waiver rationale.
--     sms_ledger_append REFUSES those by design ("a zero-value movement is
--     not an event"), so it silently did nothing -- and a row COUNT alone did
--     not reveal it. The rationale now rides on the consume notes and that
--     compensating entry.
--
-- Pre-existing, NOT introduced here: sms_allowance_used runs one ahead of the
-- ledger's allowance total for this group (3 vs 2 before, 7 vs 6 after). One
-- allowance consumption older than the ledger never got an entry. Left alone.
-- =============================================================================
