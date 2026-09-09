-- =============================================================================
-- 166: Terminally-unknown delivery outcomes (SMS-REAUDIT-2026-09-02 F5)
--
-- 151 rows sit permanently at status='sent' and can never move again:
--
--   * 112 from a 30-minute window on 2026-07-01 — the C2 bug cohort, corrected
--     from 'failed' to 'sent' by a backfill that never set sent_at. The DLR
--     poller requires sent_at IS NOT NULL, so it has never been able to see
--     them.
--   * 39 sent 2026-08-12..20, now older than the poller's 7-day window.
--
-- Neither cohort costs anything — both are excluded from the poll query, so
-- they consume no budget — and no money is at risk (26 consumed, 121
-- pre-reservation 'none', 4 released, zero stranded in 'reserved'). The
-- problem is purely that T3-1's closure metric ("rows stuck 'sent' >7 days
-- trends to 0") became unmeetable: those rows will never be polled again, so
-- the number can never reach 0 and every future audit re-flags it.
--
-- ── Why a marker and NOT a status change ──
-- The obvious move is to write some terminal value into `status`. There isn't
-- an honest one. sms_status is (queued, sent, delivered, failed, rejected):
--   * 'failed' is FALSE — these carry real provider_msg_id values and most
--     very likely delivered. It would also corrupt every lifetime
--     failure-rate figure computed from this column.
--   * 'delivered' is an equally invented claim.
--   * adding an 'unknown' value widens an enum that the UI, the analytics
--     summary, the validators and the DLR classifier all switch on, and it
--     changes a value shipped over /api/v1/*.
--
-- And 'sent' is not wrong. The provider DID accept these messages. The fact we
-- lack is the delivery outcome; the fact we want to record is that we STOPPED
-- ASKING. Those are different, which is why the pathway's own wording was
-- "mark messages terminally-unknown" rather than "mark them failed".
--
-- So: the delivery record is left exactly as it happened, and this column
-- annotates it.
-- =============================================================================

ALTER TABLE sms_usage_logs
  ADD COLUMN IF NOT EXISTS dlr_abandoned_at TIMESTAMPTZ;

COMMENT ON COLUMN sms_usage_logs.dlr_abandoned_at IS
  'When delivery tracking gave up on this message. The provider accepted it '
  '(status stays ''sent''); we simply never learned whether it arrived and '
  'will never ask again. NULL means either resolved or still pollable. '
  'Distinct from failure: this is an absence of knowledge, not a bad outcome.';

-- The reporting predicate: "still genuinely stuck" is now
-- status='sent' AND dlr_abandoned_at IS NULL. Partial, because rows that are
-- resolved or abandoned are never the ones being counted.
CREATE INDEX IF NOT EXISTS idx_sms_usage_dlr_unresolved
  ON sms_usage_logs (sent_at)
  WHERE status = 'sent' AND dlr_abandoned_at IS NULL;

-- ─── Backfill the two cohorts ────────────────────────────────────────────────
--
-- Deliberately expressed as the poller's OWN eligibility rules inverted,
-- rather than as a hardcoded list of ids: any row the poller can no longer
-- reach is by definition one we will never learn the outcome of. That keeps
-- this migration correct if the counts have shifted since it was written.

UPDATE sms_usage_logs
   SET dlr_abandoned_at = NOW()
 WHERE status = 'sent'
   AND dlr_abandoned_at IS NULL
   AND (
     -- Cohort 1: unreachable because the poller requires sent_at.
     sent_at IS NULL
     -- Cohort 2: aged out of the 7-day polling window.
     OR sent_at < NOW() - INTERVAL '7 days'
   );
