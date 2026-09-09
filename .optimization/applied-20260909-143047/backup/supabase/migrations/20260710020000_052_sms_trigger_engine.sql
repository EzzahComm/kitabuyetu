-- ============================================================================
-- 052 — SMS trigger / automation engine
--
-- Replaces hardcoded `smsService.send()` calls scattered through business code
-- with configurable WHEN <event> THEN <send template> rules.
--
-- Two tables:
--   sms_trigger_rules      — the configurable WHEN/THEN definitions
--   sms_trigger_executions — append-only ledger; doubles as the idempotency key
--
-- Scoping follows the platform's existing tenancy: a rule belongs to a group,
-- to an organization (applying to every group that organization oversees, via organization_group_access),
-- or to neither (a platform-wide default). Precedence is resolved in the engine:
-- group beats organization beats platform for rules sharing the same `name`.
-- ============================================================================

-- ─── Rules ───────────────────────────────────────────────────────────────────

CREATE TABLE sms_trigger_rules (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Exactly one scope, or neither (= platform default). Never both.
  group_id        UUID        REFERENCES groups        (id) ON DELETE CASCADE,
  organization_id UUID        REFERENCES organizations (id) ON DELETE CASCADE,

  name           VARCHAR(100) NOT NULL,
  description    TEXT,
  event_type     VARCHAR(60)  NOT NULL,

  -- Condition DSL evaluated against the event payload. `{}` = always match.
  -- Shape: {all|any:[...]} | {not:{...}} | {field,op,value}. See lib/sms/conditions.ts.
  conditions     JSONB        NOT NULL DEFAULT '{}'::jsonb,

  -- THEN: render this template and send it to these recipients.
  template_key   VARCHAR(50)  NOT NULL,
  recipient_spec JSONB        NOT NULL,

  -- Delayed actions: 0 = send inline, >0 = enqueue for run_at = now + delay.
  delay_seconds  INTEGER      NOT NULL DEFAULT 0 CHECK (delay_seconds >= 0 AND delay_seconds <= 2592000),
  max_retries    SMALLINT     NOT NULL DEFAULT 3 CHECK (max_retries BETWEEN 0 AND 10),

  is_active      BOOLEAN      NOT NULL DEFAULT true,
  created_by     UUID         REFERENCES members (id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_trigger_rules_single_scope CHECK (NOT (group_id IS NOT NULL AND organization_id IS NOT NULL))
);

-- A rule `name` is the identity used for precedence override, so it must be
-- unique per scope + event. Partial indexes because NULLs don't compare equal.
CREATE UNIQUE INDEX idx_trigger_rules_group_name ON sms_trigger_rules (group_id, event_type, name)
  WHERE group_id IS NOT NULL;
CREATE UNIQUE INDEX idx_trigger_rules_org_name   ON sms_trigger_rules (organization_id, event_type, name)
  WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX idx_trigger_rules_platform_name ON sms_trigger_rules (event_type, name)
  WHERE group_id IS NULL AND organization_id IS NULL;

-- Hot path: "which active rules match this event_type?" on every emit.
CREATE INDEX idx_trigger_rules_event ON sms_trigger_rules (event_type) WHERE is_active;

-- ─── Executions (append-only audit + idempotency) ────────────────────────────

CREATE TYPE sms_trigger_status AS ENUM ('pending', 'sent', 'failed', 'suppressed');

CREATE TABLE sms_trigger_executions (
  id            UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id       UUID               NOT NULL REFERENCES sms_trigger_rules (id) ON DELETE CASCADE,
  group_id      UUID               NOT NULL REFERENCES groups (id) ON DELETE CASCADE,

  event_type    VARCHAR(60)        NOT NULL,
  -- The originating business row id (payment id, loan id, …). Together with
  -- rule_id this is the idempotency key: a replayed M-Pesa callback re-emits
  -- the same event_id and the ON CONFLICT DO NOTHING insert suppresses the
  -- duplicate send.
  event_id      UUID               NOT NULL,
  event_payload JSONB              NOT NULL DEFAULT '{}'::jsonb,

  status        sms_trigger_status NOT NULL DEFAULT 'pending',
  reason        TEXT,
  sms_log_ids   UUID[]             NOT NULL DEFAULT '{}',
  recipients    SMALLINT           NOT NULL DEFAULT 0,

  attempts      SMALLINT           NOT NULL DEFAULT 0,
  scheduled_for TIMESTAMPTZ,
  executed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ        NOT NULL DEFAULT NOW(),

  CONSTRAINT sms_trigger_exec_idempotent UNIQUE (rule_id, event_id)
);

CREATE INDEX idx_trigger_exec_group   ON sms_trigger_executions (group_id, created_at DESC);
CREATE INDEX idx_trigger_exec_rule    ON sms_trigger_executions (rule_id, created_at DESC);
CREATE INDEX idx_trigger_exec_event   ON sms_trigger_executions (event_type, event_id);
-- Recovery scan: pending rows whose delayed job never landed.
CREATE INDEX idx_trigger_exec_pending ON sms_trigger_executions (scheduled_for)
  WHERE status = 'pending';

-- Executions are an audit record: insert + the engine's own status transition
-- only. No UPDATE of historical fields, no DELETE. Enforced by trigger because
-- RLS cannot express "only these columns, only forward".
CREATE OR REPLACE FUNCTION sms_trigger_exec_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'sms_trigger_executions is append-only; DELETE is not permitted';
  END IF;

  -- Only the dispatch-outcome columns may ever change, and only out of 'pending'.
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'sms_trigger_executions row % is already terminal (%)', OLD.id, OLD.status;
  END IF;
  IF NEW.rule_id  <> OLD.rule_id  OR NEW.group_id <> OLD.group_id
     OR NEW.event_id <> OLD.event_id OR NEW.event_type <> OLD.event_type
     OR NEW.created_at <> OLD.created_at OR NEW.event_payload <> OLD.event_payload THEN
    RAISE EXCEPTION 'sms_trigger_executions identity columns are immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sms_trigger_exec_immutable
  BEFORE UPDATE OR DELETE ON sms_trigger_executions
  FOR EACH ROW EXECUTE FUNCTION sms_trigger_exec_immutable();

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE sms_trigger_rules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_trigger_executions ENABLE ROW LEVEL SECURITY;

-- Rules: your own group's rules, plus organization/platform rules that apply to you.
-- Read-through of inherited rules is intentional — an officer should be able to
-- see why an automated SMS fired even when the rule was defined above them.
CREATE POLICY rls_sms_trigger_rules ON sms_trigger_rules
  FOR ALL USING (
    (group_id IS NULL AND organization_id IS NULL)
    OR group_id::TEXT = current_setting('app.current_group_id', TRUE)
    OR organization_id IN (
      SELECT nga.organization_id FROM organization_group_access nga
      WHERE nga.group_id::TEXT = current_setting('app.current_group_id', TRUE)
        AND nga.is_active = true
    )
  );

CREATE POLICY rls_sms_trigger_executions ON sms_trigger_executions
  FOR ALL USING (group_id::TEXT = current_setting('app.current_group_id', TRUE));

-- ─── Seed: preserve today's hardcoded behaviour as a platform default ────────
-- Mirrors the inline send previously living in app/api/v1/mpesa/callback/route.ts.
-- The system template reproduces that message verbatim, so moving the send
-- behind a rule changes no member-visible text.

INSERT INTO sms_templates (group_id, template_key, name, body, variables, category, is_system)
VALUES (
  NULL,
  'payment_received',
  'M-Pesa payment receipt',
  'KitabuYetu: Payment of KES {{amount}} received. Receipt: {{receipt}}. Thank you.',
  ARRAY['amount','receipt'],
  'payments',
  true
);

INSERT INTO sms_trigger_rules (name, description, event_type, template_key, recipient_spec, conditions)
VALUES (
  'payment_received_receipt',
  'Send an M-Pesa payment receipt to the paying number.',
  'payment.received',
  'payment_received',
  '{"type":"event_phone","field":"phone"}'::jsonb,
  '{"field":"phone","op":"exists"}'::jsonb
);
