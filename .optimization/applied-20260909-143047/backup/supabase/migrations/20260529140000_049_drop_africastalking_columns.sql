-- =============================================================================
-- 048_drop_africastalking_columns.sql
-- The platform sends SMS exclusively through the TextSMS (textsms.co.ke)
-- gateway. sms_usage_logs still carried two legacy Africa's Talking columns:
--   • at_message_id — overloaded to mirror provider_msg_id on every write
--   • at_cost       — never populated
-- Backfill any provider_msg_id still NULL from at_message_id (so historical
-- delivery tracking keeps working), then drop both columns and the now-unused
-- index. Idempotent.
-- =============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sms_usage_logs' AND column_name = 'at_message_id'
  ) THEN
    UPDATE sms_usage_logs
       SET provider_msg_id = at_message_id
     WHERE provider_msg_id IS NULL
       AND at_message_id IS NOT NULL;
  END IF;
END
$$;

DROP INDEX IF EXISTS idx_sms_usage_at_message_id;

ALTER TABLE sms_usage_logs
  DROP COLUMN IF EXISTS at_message_id,
  DROP COLUMN IF EXISTS at_cost;
