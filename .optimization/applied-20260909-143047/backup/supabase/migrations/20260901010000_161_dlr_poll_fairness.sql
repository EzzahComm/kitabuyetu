-- =============================================================================
-- 161: Let the DLR poller reach every message, not just the oldest few
--      (SMS-AUDIT-v3 G3 / INV-17)
--
-- pollPendingDlrs selects status='sent' ordered by sent_at ASC and records
-- nothing about having polled. A message the provider never reports on stays
-- 'sent' forever, so it re-qualifies on every tick and holds a slot at the
-- head of the queue for the full 7-day window. Once enough of those exist,
-- every slot is taken and NEWER messages are never polled at all — they age
-- out of the window still 'sent', which is indistinguishable from the outage
-- this window was widened to survive.
--
-- Not hypothetical: 175 of 353 lifetime messages sit at status='sent' in
-- production, the oldest since 2026-07-01, while sms_delivery_reports holds
-- 54 'pending' against 7 'delivered'.
--
-- poll_count lets the query order least-recently-polled first and back off
-- geometrically, so a message nobody will ever report on decays to a rare
-- re-check instead of monopolising the budget, and a message sent a minute ago
-- gets looked at. queried_at already existed and was already maintained; it
-- was simply never read back.
-- =============================================================================

ALTER TABLE sms_delivery_reports
  ADD COLUMN IF NOT EXISTS poll_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN sms_delivery_reports.poll_count IS
  'How many times this message has been polled for a delivery report. Drives '
  'the exponential back-off in pollPendingDlrs so unreportable messages do '
  'not starve newer ones.';

-- The poller orders by queried_at across the whole eligible set, so it needs
-- to be indexed. Partial: a terminal report is never re-polled.
CREATE INDEX IF NOT EXISTS idx_dlr_queried_at
  ON sms_delivery_reports (queried_at)
  WHERE status NOT IN ('delivered', 'failed');
