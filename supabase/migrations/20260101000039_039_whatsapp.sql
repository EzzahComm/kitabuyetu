-- =============================================================================
-- 039_whatsapp.sql — mirror of canonical migrations/023_whatsapp.sql
-- Phase E10 (Part 1) — WhatsApp messaging audit log.
-- =============================================================================

CREATE TYPE whatsapp_message_status AS ENUM (
  'pending', 'sent', 'delivered', 'read', 'failed', 'dry_run'
);

CREATE TYPE whatsapp_message_direction AS ENUM ('outbound', 'inbound');

CREATE TABLE whatsapp_messages (
  id              UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID                       NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id       UUID                       REFERENCES members (id) ON DELETE SET NULL,
  direction       whatsapp_message_direction NOT NULL DEFAULT 'outbound',
  to_phone        VARCHAR(20)                NOT NULL,
  from_phone      VARCHAR(20),
  message_type    VARCHAR(20)                NOT NULL DEFAULT 'text',
  body            TEXT,
  template_name   VARCHAR(80),
  template_vars   JSONB,
  status          whatsapp_message_status    NOT NULL DEFAULT 'pending',
  wa_message_id   VARCHAR(120),
  error_code      VARCHAR(40),
  error_message   TEXT,
  sent_by         UUID                       REFERENCES members (id) ON DELETE SET NULL,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ,
  failed_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_wa_phone_to CHECK (length(to_phone) > 0)
);

CREATE INDEX idx_wa_group_created    ON whatsapp_messages (group_id, created_at DESC);
CREATE INDEX idx_wa_group_status     ON whatsapp_messages (group_id, status);
CREATE INDEX idx_wa_member           ON whatsapp_messages (member_id, created_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX idx_wa_message_id       ON whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX idx_wa_direction        ON whatsapp_messages (group_id, direction, created_at DESC);

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE  ROW LEVEL SECURITY;

CREATE POLICY whatsapp_messages_select ON whatsapp_messages
  FOR SELECT USING (is_super_admin() OR group_id = app_current_group_id());
CREATE POLICY whatsapp_messages_modify ON whatsapp_messages
  FOR ALL USING (is_super_admin() OR (group_id = app_current_group_id() AND app_current_role() IN ('group_admin', 'treasurer', 'secretary')));
