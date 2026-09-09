-- =============================================================================
-- 014_email_billing_tables.sql (corrected)
--
-- What this migration does:
--   1. Adds sequences + helper functions for invoice/receipt numbering
--   2. Creates ONLY the tables not already in 012_email_system.sql:
--        email_delivery_reports, email_failures, contact_submissions,
--        newsletter_subscribers, invoice_line_items
--   3. Adds updated_at triggers for 012_email_system tables (012 created the
--      tables but did not wire up triggers)
--   4. Enables RLS and creates group-scoped policies for 012 tables
--
-- Tables already created by earlier migrations (do NOT recreate here):
--   invoices, invoice_items            → 005_billing.sql
--   email_logs, email_templates,
--   group_email_branding, email_campaigns,
--   email_campaign_recipients,
--   email_schedules, email_preferences,
--   notification_rules,
--   payment_receipts, invoice_schedules → 012_email_system.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Sequence + function for receipt numbers (invoice numbering already handled
-- by next_invoice_number() defined in migration 009)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1;

CREATE OR REPLACE FUNCTION next_receipt_number() RETURNS VARCHAR(50)
LANGUAGE sql SET search_path = public AS $$
  SELECT 'RCP-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(nextval('receipt_number_seq')::TEXT, 5, '0');
$$;

-- ---------------------------------------------------------------------------
-- email_delivery_reports — provider webhook / callback events
-- ---------------------------------------------------------------------------
CREATE TABLE email_delivery_reports (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  email_log_id        UUID        REFERENCES email_logs (id) ON DELETE SET NULL,
  provider_message_id VARCHAR(100) NOT NULL,
  event_type          VARCHAR(30) NOT NULL
                        CHECK (event_type IN ('delivered','opened','clicked','bounced','complained','unsubscribed')),
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_dlr_log  ON email_delivery_reports (email_log_id);
CREATE INDEX idx_email_dlr_msg  ON email_delivery_reports (provider_message_id);
CREATE INDEX idx_email_dlr_type ON email_delivery_reports (event_type);

-- ---------------------------------------------------------------------------
-- email_failures — persistent retry log for failed sends
-- ---------------------------------------------------------------------------
CREATE TABLE email_failures (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  email_log_id   UUID        REFERENCES email_logs (id) ON DELETE SET NULL,
  to_email       TEXT        NOT NULL,
  subject        TEXT        NOT NULL,
  template_key   VARCHAR(50),
  payload        JSONB,
  failure_code   VARCHAR(20),
  failure_reason TEXT        NOT NULL,
  retry_count    INTEGER     NOT NULL DEFAULT 0,
  max_retries    INTEGER     NOT NULL DEFAULT 5,
  last_retry_at  TIMESTAMPTZ,
  next_retry_at  TIMESTAMPTZ,
  is_billing     BOOLEAN     NOT NULL DEFAULT false,
  resolved       BOOLEAN     NOT NULL DEFAULT false,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_fail_group   ON email_failures (group_id);
CREATE INDEX idx_email_fail_retry   ON email_failures (next_retry_at) WHERE NOT resolved;
CREATE INDEX idx_email_fail_billing ON email_failures (is_billing)     WHERE is_billing AND NOT resolved;

-- ---------------------------------------------------------------------------
-- invoice_line_items — individual line items on an invoice
-- ---------------------------------------------------------------------------
CREATE TABLE invoice_line_items (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id  UUID          NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
  description TEXT          NOT NULL,
  quantity    NUMERIC(10,2) NOT NULL DEFAULT 1,
  unit_price  NUMERIC(15,2) NOT NULL,
  total       NUMERIC(15,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  sort_order  INTEGER       NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_line_items_invoice ON invoice_line_items (invoice_id);

-- ---------------------------------------------------------------------------
-- contact_submissions — public contact form inquiries
-- ---------------------------------------------------------------------------
CREATE TABLE contact_submissions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL,
  email      TEXT        NOT NULL,
  subject    VARCHAR(50) NOT NULL,
  message    TEXT        NOT NULL,
  ip_address INET,
  is_read    BOOLEAN     NOT NULL DEFAULT false,
  read_at    TIMESTAMPTZ,
  read_by    UUID        REFERENCES members (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_contact_read ON contact_submissions (is_read) WHERE NOT is_read;
CREATE INDEX idx_contact_date ON contact_submissions (created_at DESC);

-- ---------------------------------------------------------------------------
-- newsletter_subscribers — double opt-in newsletter list per tenant
-- ---------------------------------------------------------------------------
CREATE TABLE newsletter_subscribers (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID        REFERENCES groups (id) ON DELETE RESTRICT,
  email              TEXT        NOT NULL,
  name               TEXT,
  confirmation_token UUID        NOT NULL DEFAULT gen_random_uuid(),
  confirmed_at       TIMESTAMPTZ,
  unsubscribed_at    TIMESTAMPTZ,
  ip_address         INET,
  source             VARCHAR(50) NOT NULL DEFAULT 'website',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT newsletter_sub_unique UNIQUE (group_id, email)
);

CREATE INDEX idx_newsletter_email     ON newsletter_subscribers (email);
CREATE INDEX idx_newsletter_confirmed ON newsletter_subscribers (confirmed_at)
  WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL;
CREATE INDEX idx_newsletter_token     ON newsletter_subscribers (confirmation_token);

-- ---------------------------------------------------------------------------
-- Updated_at triggers
-- For tables from 012_email_system.sql that have updated_at but no trigger,
-- plus the new tables above.
-- ---------------------------------------------------------------------------
CREATE TRIGGER trg_email_branding_updated
  BEFORE UPDATE ON group_email_branding
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_templates_updated
  BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_campaigns_updated
  BEFORE UPDATE ON email_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_schedules_updated
  BEFORE UPDATE ON email_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_preferences_updated
  BEFORE UPDATE ON email_preferences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_notification_rules_updated
  BEFORE UPDATE ON notification_rules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_receipts_updated
  BEFORE UPDATE ON payment_receipts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_inv_schedules_updated
  BEFORE UPDATE ON invoice_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_logs_updated
  BEFORE UPDATE ON email_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_email_failures_updated
  BEFORE UPDATE ON email_failures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security — enable on 012 tables (012 created them without RLS)
-- ---------------------------------------------------------------------------
ALTER TABLE group_email_branding    ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_schedules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_preferences       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_receipts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_schedules       ENABLE ROW LEVEL SECURITY;

-- Enable on new tables
ALTER TABLE email_delivery_reports  ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_failures          ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_line_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE newsletter_subscribers  ENABLE ROW LEVEL SECURITY;

-- Group-scoped policy for all group-owned tables
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'group_email_branding', 'email_logs', 'email_templates',
    'email_campaigns', 'email_campaign_recipients',
    'email_schedules', 'email_preferences', 'notification_rules',
    'payment_receipts', 'invoice_schedules',
    'email_delivery_reports', 'email_failures',
    'newsletter_subscribers'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (group_id::TEXT = current_setting(''app.current_group_id'', TRUE))',
      'rls_' || tbl || '_group', tbl
    );
  END LOOP;
END;
$$;

-- invoice_line_items: via parent invoice
CREATE POLICY rls_inv_line_items ON invoice_line_items
  FOR ALL USING (
    invoice_id IN (
      SELECT id FROM invoices
      WHERE group_id::TEXT = current_setting('app.current_group_id', TRUE)
    )
  );

-- contact_submissions: admin-only
CREATE POLICY rls_contact_subs ON contact_submissions
  FOR ALL USING (
    current_setting('app.current_role', TRUE) IN ('super_admin','group_admin')
  );
