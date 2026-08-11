-- =============================================================================
-- backfill-112-misrecorded-sms-rows.sql
--
-- ONE-TIME, MANUAL data-correction script — NOT a supabase/migrations file.
-- CI seeds no historical data, so this has nothing to run against there; it
-- belongs in this project's ops scripts, applied by hand to production only.
--
-- Decision C (docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md §7): 112 of
-- the 270 historical sms_usage_logs rows have status='failed' with
-- failed_reason literally 'Success' and a real provider provider_msg_id —
-- genuinely delivered, misrecorded before the Phase 1 fix
-- (Number(code)===200 vs "200"===200, textsms.service.ts:143). All 112
-- currently have credits_deducted=0. The other 158 of the 270 are genuine
-- failures (401/422/500) — untouched by this script.
--
-- WHAT THIS DOES, per the user's explicit decision (not the status-only
-- option): (a) fixes status to 'sent' (data accuracy), AND (b) retroactively
-- charges credits_deducted for real, deducting from each affected group's
-- CURRENT billing_accounts.sms_credits.
--
-- ASSUMPTION THIS SCRIPT VERIFIES BEFORE DOING ANYTHING: there is no
-- historical rate-at-send-time stored anywhere on these rows, so the only
-- defensible number is each group's CURRENT active subscriptions.sms_rate.
-- At authoring time this is uniformly 0.9000 for all 5 production groups
-- (register_group has always hardcoded it and nothing has ever changed it) —
-- but this script does NOT silently assume that still holds. It aborts
-- loudly if any affected group's current active rate isn't 0.9000.
--
-- ASSUMPTION: sms_usage_logs is strictly 1 row = 1 recipient = 1 message
-- (recipient_phone is NOT NULL, no recipient_count-style column exists —
-- verified against supabase/migrations/20260101000005_006_sms.sql). So each
-- of the 112 rows is exactly 1 SMS, no multiplier needed.
--
-- OUT OF SCOPE, DELIBERATELY: does not touch billing_state / credits_reserved
-- / credits_from_allowance / reserved_at / settled_at, and does not call
-- reserve_sms_credits or settle_sms_credit_reservation. These are finalized
-- historical records being corrected directly, not an in-flight reservation
-- lifecycle — running them through that machinery would be wrong, not just
-- unnecessary. It also does not touch billing_accounts.sms_allowance_used —
-- these sends predate the bundled allowance (migration 124) entirely, so
-- backdating an allowance consumption against a period that didn't exist for
-- them would be its own kind of wrong.
--
-- IDEMPOTENT: the driving WHERE clause (status='failed' AND
-- failed_reason='Success' AND credits_deducted=0) stops matching the moment
-- a row is fixed, so re-running this whole script after it has already run
-- is a safe no-op — the CTE-based UPDATE below naturally decrements
-- billing_accounts by exactly the sum of whatever rows it just flipped,
-- which is zero on a second run.
--
-- HOW TO RUN:
--   1. First run everything through with `ROLLBACK;` instead of `COMMIT;` at
--      the bottom, to inspect exactly which rows, groups and amounts would
--      be affected before committing anything.
--   2. Re-run with `COMMIT;` once the dry run looks right.
--   Apply directly to production by hand (Supavisor session pooler — the
--   direct db.<ref>.supabase.co host is IPv6-only and unreachable from most
--   networks — or the Supabase dashboard SQL editor), independent of and not
--   blocking the Phase 2b migration's own review.
-- =============================================================================

BEGIN;

-- ─── 1. Abort loudly if the rate assumption doesn't hold ────────────────────

DO $$
DECLARE
  v_bad_groups INTEGER;
BEGIN
  SELECT COUNT(DISTINCT l.group_id) INTO v_bad_groups
  FROM sms_usage_logs l
  JOIN subscriptions s
    ON s.group_id = l.group_id AND s.status = 'active'
  WHERE l.status = 'failed'
    AND l.failed_reason = 'Success'
    AND l.credits_deducted = 0
    AND l.provider_msg_id IS NOT NULL
    AND l.payer_type = 'group'
    AND s.sms_rate <> 0.9000;

  IF v_bad_groups > 0 THEN
    RAISE EXCEPTION
      'ABORTED: % affected group(s) have an active sms_rate other than 0.9000 — the "current rate" assumption does not hold for every group. Investigate before charging.',
      v_bad_groups;
  END IF;
END $$;

-- ─── 2. Preview — inspect before committing ─────────────────────────────────

SELECT l.group_id,
       COUNT(*)                    AS rows_to_fix,
       s.sms_rate                  AS rate_to_apply,
       COUNT(*) * s.sms_rate       AS total_charge,
       ba.sms_credits              AS current_balance,
       GREATEST(ba.sms_credits - COUNT(*) * s.sms_rate, 0) AS balance_after
FROM sms_usage_logs l
JOIN subscriptions s      ON s.group_id = l.group_id AND s.status = 'active'
JOIN billing_accounts ba  ON ba.group_id = l.group_id
WHERE l.status = 'failed'
  AND l.failed_reason = 'Success'
  AND l.credits_deducted = 0
  AND l.provider_msg_id IS NOT NULL
  AND l.payer_type = 'group'
GROUP BY l.group_id, s.sms_rate, ba.sms_credits
ORDER BY l.group_id;

-- Sanity check the total row count matches the known 112 before proceeding.
-- A count other than 112 here is not necessarily wrong — it could mean this
-- has already partially run — but it must be understood, not ignored.
SELECT COUNT(*) AS candidate_rows
FROM sms_usage_logs l
JOIN subscriptions s ON s.group_id = l.group_id AND s.status = 'active'
WHERE l.status = 'failed'
  AND l.failed_reason = 'Success'
  AND l.credits_deducted = 0
  AND l.provider_msg_id IS NOT NULL
  AND l.payer_type = 'group'
  AND s.sms_rate = 0.9000;

-- ─── 3. Fix status + charge, and decrement the balance, atomically ──────────
--
-- Single statement: the UPDATE...RETURNING in `affected` drives the group-
-- level decrement in the outer UPDATE, so if `affected` returns 0 rows (this
-- has already been applied), the outer UPDATE naturally decrements nothing.

WITH affected AS (
  UPDATE sms_usage_logs l
  SET status           = 'sent',
      credits_deducted = s.sms_rate,
      updated_at        = NOW()
  FROM subscriptions s
  WHERE s.group_id  = l.group_id
    AND s.status    = 'active'
    AND s.sms_rate  = 0.9000
    AND l.status         = 'failed'
    AND l.failed_reason   = 'Success'
    AND l.credits_deducted = 0
    AND l.provider_msg_id IS NOT NULL
    AND l.payer_type      = 'group'
  RETURNING l.id, l.group_id, s.sms_rate AS amount
)
UPDATE billing_accounts ba
SET sms_credits = GREATEST(ba.sms_credits - agg.total_amount, 0),
    updated_at  = NOW()
FROM (
  SELECT group_id, SUM(amount) AS total_amount, COUNT(*) AS row_count
  FROM affected
  GROUP BY group_id
) agg
WHERE ba.group_id = agg.group_id
RETURNING ba.group_id, agg.row_count, agg.total_amount, ba.sms_credits AS new_balance;

-- ─── 4. Verify — should show 0 remaining candidates after a real run ────────

SELECT COUNT(*) AS remaining_candidates
FROM sms_usage_logs
WHERE status = 'failed' AND failed_reason = 'Success' AND credits_deducted = 0
  AND provider_msg_id IS NOT NULL AND payer_type = 'group';

-- Swap to ROLLBACK for the first dry-run pass; COMMIT once verified.
COMMIT;
-- ROLLBACK;
