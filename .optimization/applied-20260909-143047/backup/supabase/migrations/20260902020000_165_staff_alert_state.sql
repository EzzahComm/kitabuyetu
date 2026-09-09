-- =============================================================================
-- 165: Alert-delivery state for background controls (SMS-REAUDIT-2026-09-02 F2)
--
-- The re-audit's headline finding: the controls built by T1-6 detect correctly
-- and report into a void. `sms_credit_reconciliation` has logged
--
--     "SMS reconciliation: DRIFT — 1/3 campaigns disagree with their own
--      records — investigate"
--
-- on EVERY run since it shipped, and nothing routes that to a person. The
-- detector was built (T1-6); the sink was deferred (T3-4 item 1); and the
-- deferral silently disarmed the detector. A control nobody reads is not a
-- control — every billing defect this audit series found was discovered by a
-- human running a query by hand, which is exactly what these jobs exist to end.
--
-- This table is the missing half: it remembers what a background job has
-- already told staff about, so a job can email when something is WRONG without
-- emailing every single run about the same unchanged problem. Alert fatigue is
-- how a working alert becomes a filtered one.
--
-- Deliberately generic (`alert_key`, not `sms_*`): outbox.service.ts's
-- findSpineOrphans has the identical shape — its own comment calls its
-- logger.error "the paging signal" while nothing consumes logger.error — and
-- should adopt this rather than growing a third bespoke mechanism.
--
-- NOT merged into sms_provider_health_state (migration 163): that table also
-- stores health SAMPLES, which are domain data rather than alert bookkeeping.
-- =============================================================================

CREATE TABLE IF NOT EXISTS staff_alert_state (
  -- Stable identifier for the condition being watched, e.g.
  -- 'sms_credit_reconciliation'. One row per watched condition.
  alert_key        VARCHAR(80) PRIMARY KEY,

  -- A digest of WHAT was wrong last time staff were told. The whole point:
  -- an unchanged fingerprint means "same problem, already reported, stay
  -- quiet"; a changed one means something new happened and is worth an email
  -- immediately, without waiting out the re-reminder interval.
  fingerprint      TEXT,

  last_alerted_at  TIMESTAMPTZ,
  -- Every evaluation touches this, alert or not, so an operator can tell
  -- "healthy" from "nothing has run".
  last_checked_at  TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE staff_alert_state IS
  'One row per background condition that can page staff. Holds the last '
  'reported fingerprint so a persistent problem is not re-emailed every run, '
  'and a NEW problem is not suppressed by an old cool-off. Written only by '
  'job handlers on the admin pool.';

COMMENT ON COLUMN staff_alert_state.fingerprint IS
  'Digest of the condition as last reported. NULL means "resolved / nothing '
  'outstanding", which re-arms the alert so the next occurrence notifies '
  'immediately — the same re-arm defect M1 found in the low-balance alert, '
  'which stayed silent for 24h after a top-up.';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Platform-internal operational state, exactly like sms_provider_health_state.
-- No tenant has any business reading which internal controls have fired.

ALTER TABLE staff_alert_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_alert_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_staff_alert_state_super_admin ON staff_alert_state;
CREATE POLICY rls_staff_alert_state_super_admin ON staff_alert_state
  FOR ALL
  USING ((SELECT is_super_admin()));

-- Supabase grants full CRUD to anon/authenticated on every new public table.
REVOKE ALL ON public.staff_alert_state FROM anon, authenticated;

-- app_tenant gets nothing at all — not even SELECT. The jobs that maintain
-- this run on the admin pool.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    REVOKE ALL ON public.staff_alert_state FROM app_tenant;
  END IF;
END
$grant$;
