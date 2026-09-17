-- ============================================================================
-- 181_organization_report_exports.sql
-- Phase 5 (Enterprise) — async report export (PDF/Excel/CSV) + scheduled
-- reports. These are the last two gaps in the already-verified organization-
-- axis gap analysis; everything else (org KPI dashboard, portfolio health,
-- audit-on-read, member drill-down, programme-group drill-down) already
-- exists in production.
--
-- Two new tables:
--   organization_report_exports — one row per requested (ad-hoc or scheduled)
--     export. job_queue carries no result column — its `payload` is the
--     job's INPUT only (see lib/jobs/db.ts's insertJob) — so this table is
--     where the export job handler records the finished object_path or
--     failure, and what GET /api/admin/organization/reports/export/:id reads
--     back to answer pending|processing|complete|failed.
--   report_schedules — recurring report requests, polled by a new
--     self-idempotent 5-minute sweep job (organization_report_schedules_
--     process). See the note below on why this is a job-queue sweep and NOT
--     a second `cron.schedule(...)` entry.
--
-- Scheduling idiom: this codebase's pg_cron footprint is a SINGLE schedule —
-- "every 5 minutes, POST /api/cron" — provisioned once outside migrations
-- (042_enable_pg_cron.sql's own header: "Scheduling the actual job
-- (cron.schedule(...)) is a runtime config step documented in DEPLOY.md, not
-- a migration"). Every actual recurring behaviour (email digests, SMS
-- schedules, M-Pesa reconciliation, governance metrics, …) is a job TYPE
-- enqueued by lib/jobs/index.ts's enqueueTimeBasedJobs() on that one 5-minute
-- tick, not a bespoke cron.schedule(...) row. sms_process_schedules is the
-- closest sibling to what this migration needs: a payload-free, constantly-
-- keyed sweep that finds due rows and dispatches them. Adding a second raw
-- pg_cron entry here would fork that idiom for no reason — it would still be
-- gated by the exact same CRON_SECRET-authenticated /api/cron tick.
--
-- RLS mirrors organization_disbursements' per-operation policy shape
-- (migrations 055 + 122): is_super_admin() OR (app_current_role() =
-- 'organization_coordinator' AND organization_id = app_current_organization_id()),
-- with each STABLE function call wrapped in a scalar (SELECT …) — the RLS
-- policy-cost audit's fix (PR #164) so Postgres evaluates it once per
-- statement (an InitPlan) rather than once per row.
--
-- Storage: a private `reports` bucket, created the same guarded way
-- migration 074 created `group-documents` (storage.buckets only exists on
-- Supabase's own Postgres image, never on the plain postgres:*-alpine image
-- local docker-compose / the db-integration CI job use). No storage.objects
-- RLS policies are added — migration 074's group-documents bucket set none
-- either (it turns out to have never had ANY application code wired to it),
-- and this app never authenticates end users as Supabase Auth sessions (it
-- has its own JWT + Postgres-role RLS model instead), so a per-`auth.uid()`
-- storage policy would not gate anything real here. All bucket access goes
-- through the service-role client from the server (lib/supabase/storage.ts),
-- gated by this app's own route-level withOrganizationAccess check exactly
-- like every other org-axis endpoint — Storage RLS's default-deny (no
-- matching policy = no access for the anon/authenticated keys) is the
-- defense-in-depth layer underneath that.
--
-- Bucket creation, like every migration in this repo, is not auto-deployed —
-- it takes effect only once this file is applied to the production database
-- (a separate deploy step; see DEPLOY.md / the Supabase migration history).
-- ============================================================================

CREATE TABLE IF NOT EXISTS organization_report_exports (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  requested_by     UUID        REFERENCES members(id) ON DELETE SET NULL,
  report_type      TEXT        NOT NULL,
  format           TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'pending',
  object_path      TEXT,
  error            TEXT,
  job_id           UUID        REFERENCES job_queue(id) ON DELETE SET NULL,
  -- FK to report_schedules added below, after that table exists.
  schedule_id      UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,

  CONSTRAINT organization_report_exports_report_type_check CHECK (report_type IN ('program_budget', 'donor_spend')),
  CONSTRAINT organization_report_exports_format_check      CHECK (format IN ('pdf', 'xlsx', 'csv')),
  CONSTRAINT organization_report_exports_status_check      CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_organization_report_exports_org
  ON organization_report_exports (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS report_schedules (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by         UUID        REFERENCES members(id) ON DELETE SET NULL,
  report_type        TEXT        NOT NULL,
  format             TEXT        NOT NULL,
  cadence            TEXT        NOT NULL,
  recipient_emails   TEXT[]      NOT NULL DEFAULT '{}',
  notify_coordinator BOOLEAN     NOT NULL DEFAULT false,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  next_run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_run_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT report_schedules_report_type_check CHECK (report_type IN ('program_budget', 'donor_spend')),
  CONSTRAINT report_schedules_format_check      CHECK (format IN ('pdf', 'xlsx', 'csv')),
  CONSTRAINT report_schedules_cadence_check     CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  -- COALESCE(...,0), not a bare array_length() > 0: array_length() on an
  -- empty (not NULL) array returns NULL, and Postgres CHECK constraints treat
  -- a NULL result as PASS — `false OR NULL` evaluates to NULL, not false — so
  -- the bare form would silently accept notify_coordinator=false with zero
  -- recipients instead of rejecting it.
  CONSTRAINT report_schedules_recipients_check  CHECK (
    notify_coordinator OR COALESCE(array_length(recipient_emails, 1), 0) > 0
  )
);

ALTER TABLE organization_report_exports
  ADD CONSTRAINT organization_report_exports_schedule_id_fkey
  FOREIGN KEY (schedule_id) REFERENCES report_schedules(id) ON DELETE SET NULL;

-- Claim query index: the report_schedules_process sweep finds due, active
-- rows by next_run_at. Partial on is_active, mirroring idx_job_queue_pick's
-- own "index only the rows a claim query actually wants" shape.
CREATE INDEX IF NOT EXISTS idx_report_schedules_due
  ON report_schedules (next_run_at)
  WHERE is_active = true;

CREATE OR REPLACE FUNCTION update_report_schedules_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_schedules_updated_at ON report_schedules;
CREATE TRIGGER trg_report_schedules_updated_at
  BEFORE UPDATE ON report_schedules
  FOR EACH ROW EXECUTE FUNCTION update_report_schedules_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE organization_report_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_schedules            ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_report_exports_select ON organization_report_exports FOR SELECT USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY organization_report_exports_insert ON organization_report_exports FOR INSERT WITH CHECK (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY organization_report_exports_update ON organization_report_exports FOR UPDATE USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY organization_report_exports_delete ON organization_report_exports FOR DELETE USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);

CREATE POLICY report_schedules_select ON report_schedules FOR SELECT USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY report_schedules_insert ON report_schedules FOR INSERT WITH CHECK (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY report_schedules_update ON report_schedules FOR UPDATE USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);
CREATE POLICY report_schedules_delete ON report_schedules FOR DELETE USING (
  (SELECT is_super_admin())
  OR ((SELECT app_current_role()) = 'organization_coordinator' AND organization_id = (SELECT app_current_organization_id()))
);

-- ── Storage bucket ────────────────────────────────────────────────────────
-- Guarded exactly like migration 074's group-documents bucket: storage.buckets
-- is part of Supabase's Storage extension and doesn't exist on a plain
-- Postgres image.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('reports', 'reports', false)
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END $$;
