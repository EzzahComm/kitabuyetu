-- =============================================================================
-- 042_sms_dlr_unique.sql
-- One delivery-report row per provider message. The app upserts DLR status
-- via ON CONFLICT (provider_message_id); without a matching unique constraint
-- that upsert errors and the original ON CONFLICT DO NOTHING silently produced
-- duplicate rows on every poll. Dedupe existing rows (keep the most recently
-- queried), then add the constraint. Idempotent.
-- =============================================================================

-- Drop duplicates, keeping the newest by queried_at (ctid as a stable tiebreak).
DELETE FROM sms_delivery_reports a
USING sms_delivery_reports b
WHERE a.provider_message_id = b.provider_message_id
  AND (a.queried_at < b.queried_at
       OR (a.queried_at = b.queried_at AND a.ctid < b.ctid));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sms_delivery_reports_provider_msg_unique'
  ) THEN
    ALTER TABLE sms_delivery_reports
      ADD CONSTRAINT sms_delivery_reports_provider_msg_unique UNIQUE (provider_message_id);
  END IF;
END
$$;
