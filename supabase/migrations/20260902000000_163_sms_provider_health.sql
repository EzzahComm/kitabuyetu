-- =============================================================================
-- 163: Provider-health alert state (SMS-AUDIT-v3 T3-4 / G14)
--
-- There is currently NO alerting of any kind on this subsystem. The reference
-- case is the 401 outage of 2026-08-27: every welcome SMS to eight Ndengelwa
-- members failed, each was recorded as permanently 'sent' on an append-only
-- table, and it was found DAYS LATER by a human reading the database. Nothing
-- in the platform noticed, because nothing was watching.
--
-- The sms_provider_health job (hourly) samples the recent failure rate and
-- raises a staff alert. This table is what makes it raise EXACTLY ONE alert
-- per incident rather than one per run — the same claim-by-UPDATE mechanism
-- raiseLowBalanceAlert() already uses against billing_accounts, for the same
-- reason: only the caller that actually moves the timestamp is allowed to
-- notify, so concurrent or repeated runs cannot produce a burst.
--
-- One row per provider. Not per group: an outage is a PLATFORM condition, and
-- alerting every tenant about a provider fault they cannot act on is both
-- noise and a disclosure of internal operational state.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sms_provider_health_state (
  provider          VARCHAR(30) PRIMARY KEY,
  -- 'healthy' | 'degraded'. Deliberately only two values: this drives an
  -- alert/no-alert decision and a public status marker, and a richer
  -- taxonomy would imply a precision the sample does not have.
  state             VARCHAR(20)  NOT NULL DEFAULT 'healthy'
                      CHECK (state IN ('healthy', 'degraded')),
  -- When the last alert was actually SENT. NULL means "never alerted", which
  -- is why the column is nullable rather than defaulting to now(): a fresh
  -- row must be immediately eligible to alert.
  last_alerted_at   TIMESTAMPTZ,
  last_checked_at   TIMESTAMPTZ,
  -- The sample that produced `state`, kept so an operator reading this row
  -- can see WHY it says what it says without re-running the query.
  sample_total      INTEGER,
  sample_failed     INTEGER,
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE sms_provider_health_state IS
  'One row per SMS provider: current health verdict and when staff were last '
  'alerted. Written only by the sms_provider_health job (admin pool). Exists '
  'so an outage raises one alert, not one per failed message.';

-- Seed the current provider so the first run UPDATEs rather than racing on
-- an INSERT. ON CONFLICT DO NOTHING keeps this safe to re-run.
INSERT INTO sms_provider_health_state (provider, state)
VALUES ('textsms', 'healthy')
ON CONFLICT (provider) DO NOTHING;

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Platform-internal operational state. No tenant has any business reading it:
-- provider failure rates are the same class of internal figure as the platform
-- SMS float that T1-7 removed from the tenant surfaces.

ALTER TABLE sms_provider_health_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_provider_health_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_sms_provider_health_super_admin ON sms_provider_health_state;
CREATE POLICY rls_sms_provider_health_super_admin ON sms_provider_health_state
  FOR ALL
  USING ((SELECT is_super_admin()));

-- Supabase grants full CRUD to anon/authenticated on every new public table.
-- Nothing should reach this through PostgREST at all.
REVOKE ALL ON public.sms_provider_health_state FROM anon, authenticated;

-- app_tenant is deliberately granted NOTHING here — not even SELECT. The
-- least-privileged tenant role has no legitimate read of platform provider
-- health, and the job that maintains this row runs on the admin pool.
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    REVOKE ALL ON public.sms_provider_health_state FROM app_tenant;
  END IF;
END
$grant$;
