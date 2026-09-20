-- =============================================================================
-- 195: Phase 9.4.2 — email trigger engine + frequency caps
--
-- Extends SMS trigger infrastructure (migration 052) to support email channels.
-- Adds configurable frequency caps to prevent member spamming across channels.
--
-- Two new tables:
--   email_trigger_rules       — mirror of sms_trigger_rules, references email_templates
--   email_trigger_executions  — append-only audit + idempotency, like SMS counterpart
--
-- Three supporting tables:
--   frequency_caps            — rate limits (max_per_day per rule/recipient/category)
--   frequency_cap_executions  — daily bucket tracking (auto-expired)
--   email_templates           — already exists (migration 012); referenced here by key
-- =============================================================================

-- ── Email Trigger Rules (mirror of SMS, but references email_templates) ──────

CREATE TABLE email_trigger_rules (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly one scope, or neither (= platform default). Never both.
  group_id        UUID        REFERENCES groups        (id) ON DELETE CASCADE,
  organization_id UUID        REFERENCES organizations (id) ON DELETE CASCADE,

  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  event_type     VARCHAR(60)  NOT NULL,

  -- Condition DSL evaluated against the event payload (same as SMS).
  -- Shape: {all|any:[...]} | {not:{...}} | {field,op,value}. See lib/sms/conditions.ts.
  conditions     JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- THEN: render this email template and send it to these recipients.
  template_key   VARCHAR(50)  NOT NULL,
  recipient_spec JSONB        NOT NULL,

  -- Delayed actions: 0 = send inline, >0 = enqueue for run_at = now + delay.
  delay_seconds  INTEGER      NOT NULL DEFAULT 0 CHECK (delay_seconds >= 0 AND delay_seconds <= 2592000),
  max_retries    SMALLINT     NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 10),

  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_by     UUID         REFERENCES members (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT email_trigger_rules_single_scope CHECK (NOT (group_id IS NOT NULL AND organization_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_email_trigger_rules_group_name ON email_trigger_rules (group_id, event_type, name)
  WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX idx_email_trigger_rules_org_name ON email_trigger_rules (organization_id, event_type, name)
  WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX idx_email_trigger_rules_platform_name ON email_trigger_rules (event_type, name)
  WHERE group_id IS NULL AND organization_id IS NULL;
CREATE INDEX idx_email_trigger_rules_event ON email_trigger_rules (event_type) WHERE is_active;

-- ── Email Trigger Executions (append-only audit + idempotency) ─────────────

CREATE TYPE email_trigger_status AS ENUM ('pending', 'sent', 'failed', 'suppressed');

CREATE TABLE email_trigger_executions (
  id            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       UUID               NOT NULL REFERENCES email_trigger_rules (id) ON DELETE CASCADE,
  group_id      UUID               NOT NULL REFERENCES groups (id) ON DELETE CASCADE,

  event_type    VARCHAR(60)        NOT NULL,
  event_id      UUID               NOT NULL,
  event_payload JSONB              NOT NULL DEFAULT '{}'::jsonb,

  status        email_trigger_status NOT NULL DEFAULT 'pending',
  reason        TEXT,
  email_log_ids UUID[]             NOT NULL DEFAULT '{}',
  recipients    SMALLINT           NOT NULL DEFAULT 0,

  attempts      SMALLINT           NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT email_trigger_exec_idempotent UNIQUE (rule_id, event_id)
);

CREATE INDEX idx_email_trigger_exec_group   ON email_trigger_executions (group_id, created_at DESC);
CREATE INDEX idx_email_trigger_exec_rule    ON email_trigger_executions (rule_id, created_at DESC);
CREATE INDEX idx_email_trigger_exec_event   ON email_trigger_executions (event_type, event_id);
CREATE INDEX idx_email_trigger_exec_pending ON email_trigger_executions (scheduled_for)
  WHERE status = 'pending';

-- Executions are immutable: same trigger as SMS version.
CREATE OR REPLACE FUNCTION email_trigger_exec_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'email_trigger_executions is append-only; DELETE is not permitted';
  END IF;

  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'email_trigger_executions row % is already terminal (%)', OLD.id, OLD.status;
  END IF;
  IF NEW.rule_id  <> OLD.rule_id  OR NEW.group_id <> OLD.group_id
     OR NEW.event_id <> OLD.event_id OR NEW.event_type <> OLD.event_type
     OR NEW.created_at <> OLD.created_at OR NEW.event_payload <> OLD.event_payload THEN
    RAISE EXCEPTION 'email_trigger_executions identity columns are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_email_trigger_exec_immutable
  BEFORE UPDATE OR DELETE ON email_trigger_executions
  FOR EACH ROW EXECUTE FUNCTION email_trigger_exec_immutable();

-- ── Frequency Caps (rate limiting by rule, recipient, category, per day) ─────

CREATE TYPE frequency_cap_category AS ENUM ('transactional', 'marketing', 'promotional');

CREATE TABLE frequency_caps (
  id             UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id        UUID                  NOT NULL REFERENCES email_trigger_rules (id) ON DELETE CASCADE,
  group_id       UUID                  NOT NULL REFERENCES groups (id) ON DELETE CASCADE,

  event_type     VARCHAR(60)           NOT NULL,
  category       frequency_cap_category NOT NULL DEFAULT 'transactional',
  max_per_day    SMALLINT              NOT NULL DEFAULT 999 CHECK (max_per_day > 0 AND max_per_day <= 9999),

  is_active      BOOLEAN               NOT NULL DEFAULT true,
  created_by     UUID                  REFERENCES members (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ           NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ           NOT NULL DEFAULT NOW(),

  -- A rule can have at most one cap per category (transactional, marketing, …).
  CONSTRAINT frequency_caps_unique_rule_category UNIQUE (rule_id, category)
);

CREATE INDEX idx_frequency_caps_group ON frequency_caps (group_id) WHERE is_active;
CREATE INDEX idx_frequency_caps_rule ON frequency_caps (rule_id) WHERE is_active;

-- ── Daily Frequency Cap Execution Tracking ─────────────────────────────────

CREATE TABLE frequency_cap_executions (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  cap_id       UUID           NOT NULL REFERENCES frequency_caps (id) ON DELETE CASCADE,
  group_id     UUID           NOT NULL REFERENCES groups (id) ON DELETE CASCADE,

  recipient_id UUID           NOT NULL,  -- member_id or contact_id; never deleted
  sent_date    DATE           NOT NULL DEFAULT CURRENT_DATE,
  sent_count   SMALLINT       NOT NULL DEFAULT 0 CHECK (sent_count >= 0),

  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

  -- One row per (cap, recipient, date) — updated if a send happens same day.
  CONSTRAINT frequency_cap_exec_unique UNIQUE (cap_id, recipient_id, sent_date)
);

CREATE INDEX idx_frequency_cap_exec_group ON frequency_cap_executions (group_id, sent_date DESC);
-- No partial predicate here: CURRENT_DATE is STABLE, not IMMUTABLE, and
-- Postgres rejects a volatile/stable expression in an index predicate
-- ("functions in index predicate must be marked IMMUTABLE") — this
-- previously made the whole migration fail to apply anywhere, everywhere,
-- always. A plain index on sent_date is correct and sufficient; the table is
-- one row per (cap, recipient, day), bounded by daily send volume.
CREATE INDEX idx_frequency_cap_exec_date ON frequency_cap_executions (sent_date);

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE email_trigger_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_trigger_executions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE frequency_caps            ENABLE ROW LEVEL SECURITY;
ALTER TABLE frequency_cap_executions  ENABLE ROW LEVEL SECURITY;

-- Email trigger rules: same visibility as SMS (your group + org + platform).
CREATE POLICY rls_email_trigger_rules ON email_trigger_rules
  FOR ALL USING (
    (group_id IS NULL AND organization_id IS NULL)
    OR group_id::TEXT = current_setting('app.current_group_id', TRUE)
    OR organization_id IN (
      SELECT nga.organization_id FROM organization_group_access nga
      WHERE nga.group_id::TEXT = current_setting('app.current_group_id', TRUE)
        AND nga.is_active = true
    )
  );

CREATE POLICY rls_email_trigger_executions ON email_trigger_executions
  FOR ALL USING (group_id::TEXT = current_setting('app.current_group_id', TRUE));

-- Frequency caps: viewable by the group they belong to.
CREATE POLICY rls_frequency_caps ON frequency_caps
  FOR ALL USING (group_id::TEXT = current_setting('app.current_group_id', TRUE));

CREATE POLICY rls_frequency_cap_executions ON frequency_cap_executions
  FOR ALL USING (group_id::TEXT = current_setting('app.current_group_id', TRUE));

-- ── Grants ────────────────────────────────────────────────────────────────────

DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.email_trigger_rules TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.email_trigger_executions TO app_tenant';
    EXECUTE 'GRANT SELECT ON public.frequency_caps TO app_tenant';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.frequency_cap_executions TO app_tenant';
  END IF;
END
$grant$;
