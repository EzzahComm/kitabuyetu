-- =============================================================================
-- 023_whatsapp.sql
-- Phase E10 (Part 1) — WhatsApp messaging audit log.
--
-- Mirrors sms_usage_logs (mig 006) in spirit: every outbound (and eventually
-- inbound) WhatsApp message lives here with status transitions.
--
-- Status flow:
--   pending → sent → delivered → read
--          ↳ failed
--          ↳ dry_run    (env vars unset; message never left the system)
--
-- Webhook callbacks update sent_at / delivered_at / read_at / failed_at
-- (Part 2 wires the callback receiver; the columns are ready now).
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

  -- Always 'text' in Part 1 — Part 2 adds 'template' (Meta-approved templates).
  message_type    VARCHAR(20)                NOT NULL DEFAULT 'text',
  body            TEXT,
  template_name   VARCHAR(80),
  template_vars   JSONB,

  status          whatsapp_message_status    NOT NULL DEFAULT 'pending',

  -- Meta's WA message id, format 'wamid....'. NULL until the provider
  -- accepts (or for dry_run sends).
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

COMMENT ON TABLE whatsapp_messages IS
  'WhatsApp message audit log. Outbound rows are inserted by whatsappService.send; inbound rows + status updates come from the Cloud API webhook (E10.2).';

-- ─── RLS ──────────────────────────────────────────────────────────────────

ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE  ROW LEVEL SECURITY;

-- Read: anyone in the group (mirrors sms_usage_logs visibility).
CREATE POLICY whatsapp_messages_select ON whatsapp_messages
  FOR SELECT USING (
    is_super_admin()
    OR group_id = app_current_group_id()
  );

-- Write: treasurer/secretary/admin can send; webhook callbacks land via
-- the service-role connection which bypasses RLS.
CREATE POLICY whatsapp_messages_modify ON whatsapp_messages
  FOR ALL USING (
    is_super_admin()
    OR (
      group_id = app_current_group_id()
      AND app_current_role() IN ('group_admin', 'treasurer', 'secretary')
    )
  );
