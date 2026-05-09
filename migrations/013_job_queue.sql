-- ============================================================
-- Migration 013 — Supabase-backed job queue
-- ============================================================
-- Replaces Vercel Cron (limited to daily on Hobby plan) with
-- a DB-backed queue driven by Supabase pg_cron + pg_net.
--
-- Run this migration first:
--   supabase db push
--   OR paste into Supabase Dashboard → SQL Editor
--
-- Then enable extensions + schedule pg_cron (see bottom of file).
-- ============================================================

-- ── Job queue ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_queue (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',

  -- Status lifecycle: pending → processing → completed | failed
  status        TEXT        NOT NULL DEFAULT 'pending',

  -- Higher priority is processed first within the same run_at bucket
  priority      INTEGER     NOT NULL DEFAULT 0,

  -- Retry tracking
  attempts      INTEGER     NOT NULL DEFAULT 0,
  max_attempts  INTEGER     NOT NULL DEFAULT 5,

  -- Jobs with run_at > NOW() are deferred (scheduled for the future)
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Last error message (overwritten on each failure)
  last_error    TEXT,

  -- Optional dedup key: prevents the same logical job being enqueued twice.
  -- A partial unique index (below) only considers non-terminal rows.
  dedup_key     TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT job_queue_status_check CHECK (
    status IN ('pending', 'processing', 'completed', 'failed')
  ),
  CONSTRAINT job_queue_attempts_check CHECK (
    attempts >= 0 AND max_attempts > 0
  )
);

-- ── Job logs (observability) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS job_logs (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id       UUID        NOT NULL REFERENCES job_queue(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL,   -- started | completed | failed | retried
  message      TEXT,
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────
-- Primary workhorse: fetch pending jobs ordered by priority + run_at
CREATE INDEX IF NOT EXISTS idx_job_queue_pick
  ON job_queue (priority DESC, run_at ASC)
  WHERE status = 'pending';

-- Reset stuck jobs (find processing rows by updated_at)
CREATE INDEX IF NOT EXISTS idx_job_queue_processing
  ON job_queue (updated_at)
  WHERE status = 'processing';

-- Log lookups by job
CREATE INDEX IF NOT EXISTS idx_job_logs_job_id
  ON job_logs (job_id, created_at DESC);

-- Deduplication: unique dedup_key among non-terminal jobs only.
-- Completed/failed jobs are allowed to be re-scheduled with the same key.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_dedup
  ON job_queue (dedup_key)
  WHERE dedup_key IS NOT NULL
    AND status NOT IN ('completed', 'failed');

-- ── Auto-update updated_at ─────────────────────────────────────
CREATE OR REPLACE FUNCTION update_job_queue_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_job_queue_updated_at ON job_queue;
CREATE TRIGGER trg_job_queue_updated_at
  BEFORE UPDATE ON job_queue
  FOR EACH ROW EXECUTE FUNCTION update_job_queue_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
-- The app connects as the postgres superuser (BYPASSRLS), so these
-- policies are safety nets for any future role-scoped access.
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_logs  ENABLE ROW LEVEL SECURITY;

-- Service role (used by the app) has BYPASSRLS — no policy needed.
-- Add explicit policies if you ever create a restricted role.

-- ── Pruning helper (optional, call from cleanup job) ──────────
CREATE OR REPLACE FUNCTION prune_old_jobs(retention_days INT DEFAULT 30)
RETURNS INT LANGUAGE plpgsql AS $$
DECLARE
  deleted INT;
BEGIN
  DELETE FROM job_queue
  WHERE status IN ('completed', 'failed')
    AND updated_at < NOW() - (retention_days || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END;
$$;


-- ============================================================
-- SUPABASE PG_CRON SETUP
-- Run the following in Supabase Dashboard → SQL Editor AFTER
-- enabling the extensions in Dashboard → Extensions.
--
-- Step 1: Enable extensions (Dashboard → Extensions)
--   pg_cron
--   pg_net
--
-- Step 2: Schedule the job (replace placeholders below)
--
--   SELECT cron.schedule(
--     'kitabuyetu-every-5-min',
--     '*/5 * * * *',
--     $$
--     SELECT net.http_post(
--       url     := 'https://YOUR-APP.vercel.app/api/cron',
--       headers := jsonb_build_object(
--                    'Content-Type',  'application/json',
--                    'Authorization', 'Bearer YOUR_CRON_SECRET'
--                  ),
--       body    := jsonb_build_object('source', 'pg_cron')::text
--     );
--     $$
--   );
--
-- Step 3: Verify it's scheduled
--   SELECT * FROM cron.job;
--
-- Step 4: Monitor recent executions
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- To update the URL after a domain change:
--   SELECT cron.alter_job(
--     job_id := (SELECT jobid FROM cron.job WHERE jobname = 'kitabuyetu-every-5-min'),
--     command := $$ ... new command ... $$
--   );
--
-- To pause:
--   SELECT cron.alter_job(job_id := ..., active := false);
--
-- To delete:
--   SELECT cron.unschedule('kitabuyetu-every-5-min');
-- ============================================================
