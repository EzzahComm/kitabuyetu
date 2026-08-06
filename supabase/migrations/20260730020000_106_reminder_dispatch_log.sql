-- ============================================================================
-- 106 — Reminder dispatch log: platform-wide SMS/WhatsApp reminder idempotency
--
-- Closes the duplicate-notification gap found in notify_loan_due_alerts (daily
-- cron, no memory of past sends — re-notifies the same pending installment
-- every single day it's within 3 days of due, then every day it stays overdue,
-- forever). Generalized rather than loan-specific, since notify_contribution_
-- reminders and any future recurring-obligation scanner (welfare dues, etc.)
-- share the same shape: "for any obligation, a recipient should get at most
-- one notification per reminder stage for a given reference record."
--
-- Mirrors sms_trigger_executions (migration 052) — same insert-as-claim
-- pattern (UNIQUE constraint doubles as the atomic dedup key, avoiding the
-- check-then-act race a SELECT NOT EXISTS would have), same append-only
-- status-transition guard. Deliberately a NEW, separate table rather than
-- reusing sms_usage_logs/whatsapp_messages: whatsapp_messages has no
-- reference_type/reference_id columns at all, so a dedup check against
-- sms_usage_logs alone would miss every reminder that succeeded via WhatsApp
-- (notifyMember() tries WhatsApp first) and re-send it anyway — this table is
-- channel-agnostic by construction, keyed on whether a REMINDER stage was
-- dispatched, independent of which channel eventually carried it.
--
-- Unlike sms_trigger_executions, 'failed' is NOT terminal here — a genuine
-- delivery failure (provider outage, invalid phone at the time) should still
-- get a fresh attempt on the next scheduled run for the same stage, not be
-- silently abandoned forever. Only 'sent' and 'suppressed' are terminal.
-- ============================================================================

CREATE TYPE reminder_dispatch_status AS ENUM ('pending', 'sent', 'failed', 'suppressed');

CREATE TABLE reminder_dispatch_log (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       UUID    NOT NULL REFERENCES groups  (id) ON DELETE CASCADE,
  member_id      UUID    NOT NULL REFERENCES members (id) ON DELETE CASCADE,

  -- Identity of the notification: which obligation, which row, which stage.
  -- reference_type/reference_id follow the same (VARCHAR, UUID) shape already
  -- used by sms_usage_logs/notifications — obligations with no natural row of
  -- their own (e.g. "missed a contribution last month" is an absence, not a
  -- row) should reference a stable identity row they DO have (group_members.id)
  -- and fold the period into reminder_stage instead of widening this column.
  reference_type VARCHAR(50) NOT NULL,
  reference_id   UUID        NOT NULL,
  -- e.g. 'due_3_days' | 'overdue_7_days' | 'missing_contribution:2026-06'.
  -- Free text by design — new obligation types define their own stages here
  -- without a schema change.
  reminder_stage VARCHAR(80) NOT NULL,

  status         reminder_dispatch_status NOT NULL DEFAULT 'pending',
  -- Resolved once notifyMember() returns; null while pending.
  channel        VARCHAR(20),
  reason         TEXT,
  attempts       SMALLINT NOT NULL DEFAULT 0,

  -- Which job_queue run produced this attempt — audit trail only, no FK-driven
  -- behaviour depends on it.
  job_execution_id UUID REFERENCES job_queue (id) ON DELETE SET NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at        TIMESTAMPTZ,

  -- The atomic claim: an INSERT that violates this constraint IS the "already
  -- claimed" signal, checked before any send is attempted (write-before-send,
  -- same invariant lib/sms/trigger-engine.ts documents for its own table).
  CONSTRAINT reminder_dispatch_idempotent UNIQUE (reference_type, reference_id, reminder_stage)
);

CREATE INDEX idx_reminder_dispatch_group  ON reminder_dispatch_log (group_id, created_at DESC);
CREATE INDEX idx_reminder_dispatch_member ON reminder_dispatch_log (member_id, created_at DESC);
CREATE INDEX idx_reminder_dispatch_ref    ON reminder_dispatch_log (reference_type, reference_id);

-- Append-only with retriable-until-terminal semantics: 'sent'/'suppressed' can
-- never be overwritten (protects the "at most one successful send" guarantee);
-- 'pending'/'failed' may transition forward, but the claim's identity columns
-- (what this row is FOR) may never change underneath it.
CREATE OR REPLACE FUNCTION reminder_dispatch_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reminder_dispatch_log is append-only; DELETE is not permitted';
  END IF;

  IF OLD.status IN ('sent', 'suppressed') THEN
    RAISE EXCEPTION 'reminder_dispatch_log row % is already terminal (%)', OLD.id, OLD.status;
  END IF;

  IF NEW.reference_type <> OLD.reference_type OR NEW.reference_id <> OLD.reference_id
     OR NEW.reminder_stage <> OLD.reminder_stage OR NEW.group_id <> OLD.group_id
     OR NEW.member_id <> OLD.member_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'reminder_dispatch_log identity columns are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reminder_dispatch_log_immutable
  BEFORE UPDATE OR DELETE ON reminder_dispatch_log
  FOR EACH ROW EXECUTE FUNCTION reminder_dispatch_log_immutable();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- FORCE (not just ENABLE) per migration 097's hardening precedent for
-- tenant-path tables — this table is only ever written via withAdminDb today
-- (cron scanners have no tenant session context), but the policy still fences
-- off the future app_tenant/PostgREST surface exactly like sms_trigger_executions.

ALTER TABLE reminder_dispatch_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_dispatch_log FORCE  ROW LEVEL SECURITY;

CREATE POLICY rls_reminder_dispatch_log ON reminder_dispatch_log
  FOR ALL USING (group_id::TEXT = current_setting('app.current_group_id', TRUE));
