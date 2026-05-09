-- =============================================================================
-- 012_email_system.sql
-- Email system: logs, templates, branding, campaigns, schedules, preferences,
-- notification rules, payment receipts, and invoice schedule tables.
-- Also extends the invoices table for email-tracking columns.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extend invoices for email delivery tracking
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS emailed_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS overdue_notice_level   INTEGER     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at  TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- payment_receipts
-- Issued when a payment is recorded against an invoice.
-- ---------------------------------------------------------------------------
CREATE TABLE payment_receipts (
  id               UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID           NOT NULL REFERENCES groups   (id) ON DELETE RESTRICT,
  invoice_id       UUID           NOT NULL REFERENCES invoices (id) ON DELETE RESTRICT,
  receipt_number   VARCHAR(50)    NOT NULL,
  payer_user_id    UUID,
  amount_paid      NUMERIC(15,2)  NOT NULL CHECK (amount_paid > 0),
  payment_date     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  payment_method   payment_method NOT NULL,
  mpesa_receipt    VARCHAR(50),
  notes            TEXT,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  CONSTRAINT payment_receipts_number_unique UNIQUE (receipt_number)
);

CREATE INDEX idx_payment_receipts_group   ON payment_receipts (group_id);
CREATE INDEX idx_payment_receipts_invoice ON payment_receipts (invoice_id);

-- ---------------------------------------------------------------------------
-- invoice_schedules
-- Recurring invoice generation configuration.
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_schedules (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id          UUID          NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  recipient_user_id UUID,
  amount            NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  description       TEXT,
  frequency_days    INTEGER       NOT NULL CHECK (frequency_days > 0),
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  next_run_at       TIMESTAMPTZ   NOT NULL,
  last_run_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_schedules_next_run ON invoice_schedules (next_run_at)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- email_logs
-- One row per email attempt (queued → sent | failed | dry_run).
-- Column names match the INSERT statements in the email adapters exactly.
-- ---------------------------------------------------------------------------
CREATE TABLE email_logs (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID         REFERENCES groups (id) ON DELETE SET NULL,
  user_id             UUID,
  template_key        VARCHAR(100),
  category            VARCHAR(100) NOT NULL DEFAULT 'transactional',
  "to"                VARCHAR(255) NOT NULL,
  "from"              VARCHAR(255),
  subject             VARCHAR(500),
  provider            VARCHAR(50),
  status              VARCHAR(50)  NOT NULL DEFAULT 'queued',
  provider_message_id VARCHAR(255),
  sent_at             TIMESTAMPTZ,
  error_message       TEXT,
  reference_id        UUID,
  reference_type      VARCHAR(50),
  opened_at           TIMESTAMPTZ,
  clicked_at          TIMESTAMPTZ,
  bounced_at          TIMESTAMPTZ,
  unsubscribed_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_logs_group_id     ON email_logs (group_id, created_at DESC);
CREATE INDEX idx_email_logs_status       ON email_logs (status);
CREATE INDEX idx_email_logs_template_key ON email_logs (template_key);
CREATE INDEX idx_email_logs_reference    ON email_logs (reference_type, reference_id)
  WHERE reference_id IS NOT NULL;
CREATE INDEX idx_email_logs_to           ON email_logs ("to");

-- ---------------------------------------------------------------------------
-- email_templates
-- Per-group overridable templates. group_id NULL = global default.
-- Column 'body' is the raw HTML body (no html_body alias).
-- ---------------------------------------------------------------------------
CREATE TABLE email_templates (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID         REFERENCES groups (id) ON DELETE CASCADE,
  template_key VARCHAR(100) NOT NULL,
  locale       VARCHAR(10)  NOT NULL DEFAULT 'en',
  name         VARCHAR(255) NOT NULL,
  subject      VARCHAR(500) NOT NULL,
  body         TEXT         NOT NULL,
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT email_templates_key_unique UNIQUE (group_id, template_key, locale)
);

CREATE INDEX idx_email_templates_key   ON email_templates (template_key, locale);
CREATE INDEX idx_email_templates_group ON email_templates (group_id, template_key);

-- ---------------------------------------------------------------------------
-- group_email_branding
-- Per-group email branding overrides. Columns match engine.ts SELECT.
-- ---------------------------------------------------------------------------
CREATE TABLE group_email_branding (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID        NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  sender_name    VARCHAR(255),
  sender_email   VARCHAR(255),
  reply_to_email VARCHAR(255),
  logo_url       TEXT,
  primary_color  VARCHAR(7)  NOT NULL DEFAULT '#16a34a',
  footer_text    TEXT,
  website_url    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT group_email_branding_group_unique UNIQUE (group_id)
);

-- ---------------------------------------------------------------------------
-- email_campaigns
-- Bulk email campaigns with per-run analytics counters.
-- ---------------------------------------------------------------------------
CREATE TABLE email_campaigns (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID         NOT NULL REFERENCES groups   (id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  subject          VARCHAR(500) NOT NULL,
  template_key     VARCHAR(100),
  html_body        TEXT,
  text_body        TEXT,
  status           VARCHAR(50)  NOT NULL DEFAULT 'draft',
  recipient_filter JSONB,
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  total_recipients INTEGER,
  sent_count       INTEGER      NOT NULL DEFAULT 0,
  failed_count     INTEGER      NOT NULL DEFAULT 0,
  opened_count     INTEGER      NOT NULL DEFAULT 0,
  created_by       UUID         REFERENCES members (id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_campaigns_group     ON email_campaigns (group_id, status);
CREATE INDEX idx_email_campaigns_scheduled ON email_campaigns (scheduled_at)
  WHERE status = 'scheduled';

-- ---------------------------------------------------------------------------
-- email_campaign_recipients
-- Per-recipient delivery record for each campaign run.
-- ---------------------------------------------------------------------------
CREATE TABLE email_campaign_recipients (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID         NOT NULL REFERENCES email_campaigns (id) ON DELETE CASCADE,
  group_id      UUID         NOT NULL REFERENCES groups           (id) ON DELETE CASCADE,
  member_id     UUID         REFERENCES members (id) ON DELETE SET NULL,
  email         VARCHAR(255) NOT NULL,
  name          VARCHAR(255),
  status        VARCHAR(50)  NOT NULL DEFAULT 'pending',
  sent_at       TIMESTAMPTZ,
  opened_at     TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ecr_campaign_id ON email_campaign_recipients (campaign_id, status);
CREATE INDEX idx_ecr_member_id   ON email_campaign_recipients (member_id);

-- ---------------------------------------------------------------------------
-- email_schedules
-- Future / recurring email delivery. Columns match email.service.ts INSERT.
-- ---------------------------------------------------------------------------
CREATE TABLE email_schedules (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID         REFERENCES groups  (id) ON DELETE CASCADE,
  name            VARCHAR(255),
  template_key    VARCHAR(100) NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  variables       JSONB,
  schedule_type   VARCHAR(50)  NOT NULL DEFAULT 'once',
  next_run_at     TIMESTAMPTZ  NOT NULL,
  last_run_at     TIMESTAMPTZ,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_by      UUID         REFERENCES members (id) ON DELETE SET NULL,
  reference_id    UUID,
  reference_type  VARCHAR(50),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_schedules_pending ON email_schedules (next_run_at)
  WHERE is_active = true;
CREATE INDEX idx_email_schedules_group   ON email_schedules (group_id);

-- ---------------------------------------------------------------------------
-- email_preferences
-- Per-member, per-category notification opt-in/out + frequency.
-- Two partial unique indexes handle NULL group_id correctly.
-- ---------------------------------------------------------------------------
CREATE TABLE email_preferences (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  UUID         NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  group_id   UUID         REFERENCES groups (id) ON DELETE CASCADE,
  category   VARCHAR(100) NOT NULL,
  enabled    BOOLEAN      NOT NULL DEFAULT true,
  frequency  VARCHAR(50)  NOT NULL DEFAULT 'immediate',
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_email_pref_global
  ON email_preferences (member_id, category)
  WHERE group_id IS NULL;

CREATE UNIQUE INDEX idx_email_pref_group
  ON email_preferences (member_id, group_id, category)
  WHERE group_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- notification_rules
-- Configurable automation rules: event_type → conditions → actions.
-- ---------------------------------------------------------------------------
CREATE TABLE notification_rules (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID         REFERENCES groups  (id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  conditions JSONB,
  actions    JSONB,
  is_active  BOOLEAN      NOT NULL DEFAULT true,
  created_by UUID         REFERENCES members (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notification_rules_group
  ON notification_rules (group_id, event_type)
  WHERE is_active = true;
