-- =============================================================================
-- 013_sms_advanced_tables.sql
-- Extended SMS infrastructure: templates, campaigns, schedules, delivery
-- reports, failures, provider balances, and per-group SMS configuration.
-- The existing sms_usage_logs table is extended with a provider column.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extend sms_usage_logs — add TextSMS-neutral columns
-- ---------------------------------------------------------------------------
ALTER TABLE sms_usage_logs
  ADD COLUMN IF NOT EXISTS provider          VARCHAR(30)   NOT NULL DEFAULT 'textsms',
  ADD COLUMN IF NOT EXISTS provider_msg_id   VARCHAR(100),   -- TextSMS messageId
  ADD COLUMN IF NOT EXISTS network_id        VARCHAR(20),
  ADD COLUMN IF NOT EXISTS campaign_id       UUID;           -- FK set after sms_campaigns

CREATE INDEX IF NOT EXISTS idx_sms_usage_provider_msg ON sms_usage_logs (provider_msg_id)
  WHERE provider_msg_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sms_group_settings — per-group SMS configuration
-- ---------------------------------------------------------------------------
CREATE TABLE sms_group_settings (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id                 UUID        NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  sender_id                VARCHAR(20) NOT NULL DEFAULT 'KITABU',
  auto_send_contribution   BOOLEAN     NOT NULL DEFAULT true,
  auto_send_loan           BOOLEAN     NOT NULL DEFAULT true,
  auto_send_meeting        BOOLEAN     NOT NULL DEFAULT true,
  auto_send_birthday       BOOLEAN     NOT NULL DEFAULT false,
  daily_send_limit         INTEGER     NOT NULL DEFAULT 500,
  opt_out_phones           TEXT[]      NOT NULL DEFAULT '{}',
  timezone                 VARCHAR(50) NOT NULL DEFAULT 'Africa/Nairobi',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_group_settings_unique UNIQUE (group_id)
);

CREATE INDEX idx_sms_group_settings_group ON sms_group_settings (group_id);

-- ---------------------------------------------------------------------------
-- sms_templates — reusable message templates with {{variable}} placeholders
-- ---------------------------------------------------------------------------
CREATE TABLE sms_templates (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  template_key VARCHAR(50) NOT NULL,
  name         VARCHAR(100) NOT NULL,
  body         TEXT        NOT NULL,
  variables    TEXT[]      NOT NULL DEFAULT '{}',
  category     VARCHAR(30) NOT NULL DEFAULT 'custom',
  is_system    BOOLEAN     NOT NULL DEFAULT false,
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_by   UUID        REFERENCES members (id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_templates_key_unique UNIQUE (group_id, template_key)
);

CREATE INDEX idx_sms_templates_group    ON sms_templates (group_id);
CREATE INDEX idx_sms_templates_category ON sms_templates (category);
CREATE INDEX idx_sms_templates_active   ON sms_templates (is_active) WHERE is_active;

-- System-wide default templates (group_id IS NULL)
INSERT INTO sms_templates (template_key, name, body, variables, category, is_system) VALUES
  ('contribution_received', 'Contribution Received',
   'Dear {{first_name}}, your contribution of KES {{amount}} has been received. Receipt: {{receipt}}. Thank you.',
   ARRAY['first_name','amount','receipt'], 'transaction', true),
  ('loan_approved', 'Loan Approved',
   'Dear {{first_name}}, your loan of KES {{loan_amount}} has been approved. Disbursement is in progress.',
   ARRAY['first_name','loan_amount'], 'loan', true),
  ('loan_disbursed', 'Loan Disbursed',
   'Dear {{first_name}}, KES {{amount}} has been disbursed to your M-Pesa. Receipt: {{receipt}}.',
   ARRAY['first_name','amount','receipt'], 'loan', true),
  ('loan_repayment_due', 'Loan Repayment Due',
   'Dear {{first_name}}, your loan repayment of KES {{amount}} is due on {{due_date}}. Outstanding: KES {{balance}}.',
   ARRAY['first_name','amount','due_date','balance'], 'reminder', true),
  ('loan_overdue', 'Loan Overdue',
   'Dear {{first_name}}, your loan repayment of KES {{amount}} is OVERDUE. Penalty: KES {{penalty_amount}}. Please pay immediately.',
   ARRAY['first_name','amount','penalty_amount'], 'reminder', true),
  ('meeting_reminder', 'Meeting Reminder',
   'Dear {{first_name}}, {{group_name}} meeting is scheduled for {{meeting_date}} at {{meeting_location}}. Kindly attend.',
   ARRAY['first_name','group_name','meeting_date','meeting_location'], 'reminder', true),
  ('birthday', 'Birthday Message',
   E'Happy Birthday {{first_name}}! \U0001F389 Your {{group_name}} family wishes you a wonderful year ahead. Stay blessed!',
   ARRAY['first_name','group_name'], 'birthday', true),
  ('payment_confirmed', 'Payment Confirmed',
   'Dear {{first_name}}, payment of KES {{amount}} confirmed. Receipt: {{receipt}}. KitabuYetu.',
   ARRAY['first_name','amount','receipt'], 'transaction', true),
  ('welcome', 'Welcome Message',
   'Welcome to {{group_name}} on KitabuYetu! Your digital savings hub is ready. Contact your group admin to get started.',
   ARRAY['first_name','group_name'], 'onboarding', true),
  ('otp', 'OTP Verification',
   'Your KitabuYetu verification code is {{otp}}. Valid for 10 minutes. Do not share this code.',
   ARRAY['otp'], 'auth', true),
  ('group_announcement', 'Group Announcement',
   '{{group_name}}: {{message}}',
   ARRAY['group_name','message'], 'announcement', true);

-- ---------------------------------------------------------------------------
-- sms_campaigns — bulk SMS campaign management
-- ---------------------------------------------------------------------------
CREATE TABLE sms_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  name             VARCHAR(100) NOT NULL,
  description      TEXT,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','scheduled','sending','completed','failed','cancelled')),
  message          TEXT        NOT NULL,
  template_id      UUID        REFERENCES sms_templates (id),
  recipient_type   VARCHAR(20) NOT NULL DEFAULT 'all_members'
                     CHECK (recipient_type IN ('all_members','active_members','selected','custom_phones')),
  recipient_count  INTEGER     NOT NULL DEFAULT 0,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  delivered_count  INTEGER     NOT NULL DEFAULT 0,
  failed_count     INTEGER     NOT NULL DEFAULT 0,
  scheduled_at     TIMESTAMPTZ,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  raw_recipients   JSONB,        -- custom phone list or selected member IDs
  created_by       UUID        NOT NULL REFERENCES members (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_campaigns_group_id ON sms_campaigns (group_id);
CREATE INDEX idx_campaigns_status   ON sms_campaigns (status);
CREATE INDEX idx_campaigns_sched    ON sms_campaigns (scheduled_at)
  WHERE status = 'scheduled' AND scheduled_at IS NOT NULL;

-- Add FK from sms_usage_logs back to sms_campaigns
ALTER TABLE sms_usage_logs
  ADD CONSTRAINT fk_sms_usage_campaign
  FOREIGN KEY (campaign_id) REFERENCES sms_campaigns (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- sms_delivery_reports — DLR from TextSMS
-- ---------------------------------------------------------------------------
CREATE TABLE sms_delivery_reports (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  sms_log_id          UUID        REFERENCES sms_usage_logs (id) ON DELETE SET NULL,
  provider_message_id VARCHAR(100) NOT NULL,
  phone               VARCHAR(20),
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','delivered','failed','rejected','unknown')),
  network_id          VARCHAR(20),
  failure_reason      TEXT,
  delivered_at        TIMESTAMPTZ,
  queried_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_response        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dlr_group_id   ON sms_delivery_reports (group_id);
CREATE INDEX idx_dlr_msg_id     ON sms_delivery_reports (provider_message_id);
CREATE INDEX idx_dlr_status     ON sms_delivery_reports (status);
CREATE INDEX idx_dlr_log_id     ON sms_delivery_reports (sms_log_id);

-- ---------------------------------------------------------------------------
-- sms_schedules — cron / one-time scheduled SMS jobs
-- ---------------------------------------------------------------------------
CREATE TABLE sms_schedules (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         UUID        NOT NULL REFERENCES groups (id) ON DELETE RESTRICT,
  name             VARCHAR(100) NOT NULL,
  description      TEXT,
  schedule_type    VARCHAR(20) NOT NULL
                     CHECK (schedule_type IN ('one_time','daily','weekly','monthly','birthday','loan_due')),
  template_id      UUID        REFERENCES sms_templates (id),
  message          TEXT,         -- used if template_id is NULL
  recipient_type   VARCHAR(20) NOT NULL DEFAULT 'all_members'
                     CHECK (recipient_type IN ('all_members','active_members','selected','custom_phones')),
  raw_recipients   JSONB,
  cron_expression  VARCHAR(50),  -- e.g. '0 8 * * *' = 8 AM daily
  next_run_at      TIMESTAMPTZ,
  last_run_at      TIMESTAMPTZ,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  timezone         VARCHAR(50) NOT NULL DEFAULT 'Africa/Nairobi',
  days_before_due  INTEGER,      -- for loan_due type: send N days before due date
  created_by       UUID        NOT NULL REFERENCES members (id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_group_id ON sms_schedules (group_id);
CREATE INDEX idx_schedules_active   ON sms_schedules (next_run_at)
  WHERE is_active AND next_run_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- sms_failures — persistent retry log
-- ---------------------------------------------------------------------------
CREATE TABLE sms_failures (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  sms_log_id      UUID        REFERENCES sms_usage_logs (id) ON DELETE SET NULL,
  phone           VARCHAR(20) NOT NULL,
  message         TEXT        NOT NULL,
  failure_code    VARCHAR(10),
  failure_reason  TEXT        NOT NULL,
  retry_count     INTEGER     NOT NULL DEFAULT 0,
  max_retries     INTEGER     NOT NULL DEFAULT 3,
  last_retry_at   TIMESTAMPTZ,
  next_retry_at   TIMESTAMPTZ,
  resolved        BOOLEAN     NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sms_failures_group    ON sms_failures (group_id);
CREATE INDEX idx_sms_failures_retry    ON sms_failures (next_retry_at) WHERE NOT resolved;
CREATE INDEX idx_sms_failures_resolved ON sms_failures (resolved)      WHERE NOT resolved;

-- ---------------------------------------------------------------------------
-- sms_provider_balances — snapshot of SMS credit balance
-- ---------------------------------------------------------------------------
CREATE TABLE sms_provider_balances (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    VARCHAR(30)   NOT NULL DEFAULT 'textsms',
  balance     NUMERIC(15,2) NOT NULL,
  currency    VARCHAR(5)    NOT NULL DEFAULT 'KES',
  queried_by  UUID          REFERENCES members (id),
  queried_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  raw_response JSONB
);

CREATE INDEX idx_sms_balances_provider ON sms_provider_balances (provider, queried_at DESC);

-- ---------------------------------------------------------------------------
-- Updated_at triggers
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_sms_group_settings_updated
  BEFORE UPDATE ON sms_group_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sms_templates_updated
  BEFORE UPDATE ON sms_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sms_campaigns_updated
  BEFORE UPDATE ON sms_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sms_schedules_updated
  BEFORE UPDATE ON sms_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_sms_failures_updated
  BEFORE UPDATE ON sms_failures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE sms_group_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_campaigns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_delivery_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_schedules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_failures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_provider_balances ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'sms_group_settings','sms_campaigns','sms_delivery_reports',
    'sms_schedules','sms_failures'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (group_id::TEXT = current_setting(''app.current_group_id'', TRUE))',
      'rls_' || tbl || '_group', tbl
    );
  END LOOP;
END;
$$;

-- Templates: own group + system templates (group_id IS NULL)
CREATE POLICY rls_sms_templates_group ON sms_templates
  FOR ALL USING (
    group_id IS NULL OR
    group_id::TEXT = current_setting('app.current_group_id', TRUE)
  );

-- Balance: admin-only
CREATE POLICY rls_sms_balances_admin ON sms_provider_balances
  FOR ALL USING (
    current_setting('app.current_role', TRUE) IN ('super_admin','group_admin','treasurer')
  );
