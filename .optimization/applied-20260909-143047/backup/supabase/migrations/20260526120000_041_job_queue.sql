-- =============================================================================
-- 041_job_queue.sql
-- DB-backed job queue. Code under lib/jobs/* and API routes /api/cron +
-- /api/v1/workers/cron query these tables — without them every cron tick
-- crashes with "relation 'job_queue' does not exist".
--
-- This is a port of the (never-applied) canonical migrations/013_job_queue.sql
-- file into the supabase/migrations/ pipeline that is the actual deploy path.
-- Idempotent via IF NOT EXISTS so it is safe to re-run against any database
-- that already has parts of this schema (none of prod does, but staging /
-- fresh local DBs may diverge).
--
-- Scheduling — see /api/cron handler. Two paths supported:
--   A) Supabase pg_cron + pg_net  (enable extensions, then schedule via
--      cron.schedule(...). See bottom of this file for the snippet.)
--   B) Vercel Cron  (add vercel.json entry → POST /api/cron with
--      Authorization: Bearer ${CRON_SECRET}).
-- Either way the queue tables and helpers below must exist.
-- =============================================================================

-- ── Job queue ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_queue (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type          TEXT        NOT NULL,
  payload       JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'pending',
  priority      INTEGER     NOT NULL DEFAULT 0,
  attempts      INTEGER     NOT NULL DEFAULT 0,
  max_attempts  INTEGER     NOT NULL DEFAULT 5,
  run_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error    TEXT,
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

-- ── Job logs (observability) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_logs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID        NOT NULL REFERENCES job_queue(id) ON DELETE CASCADE,
  status       TEXT        NOT NULL,   -- started | completed | failed | retried
  message      TEXT,
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_job_queue_pick
  ON job_queue (priority DESC, run_at ASC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_queue_processing
  ON job_queue (updated_at)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_job_logs_job_id
  ON job_logs (job_id, created_at DESC);

-- Dedup: at most one non-terminal job per dedup_key. Terminal rows
-- (completed/failed) are allowed to repeat so the same logical job can
-- be re-scheduled in a later window.
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_queue_dedup
  ON job_queue (dedup_key)
  WHERE dedup_key IS NOT NULL
    AND status NOT IN ('completed', 'failed');

-- ── Auto-update updated_at ────────────────────────────────────────────
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

-- ── RLS ───────────────────────────────────────────────────────────────
-- The app's connection role bypasses RLS; these are safety nets for any
-- future role-scoped access. No explicit policies = service-role only.
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_logs  ENABLE ROW LEVEL SECURITY;

-- ── Pruning helper ────────────────────────────────────────────────────
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

-- =============================================================================
-- Optional: pg_cron scheduling. Run by hand in the Supabase SQL Editor
-- AFTER enabling pg_cron + pg_net in Dashboard → Extensions.
--
--   SELECT cron.schedule(
--     'kitabuyetu-every-5-min',
--     '*/5 * * * *',
--     $$
--     SELECT net.http_post(
--       url     := 'https://YOUR-APP.vercel.app/api/cron',
--       headers := jsonb_build_object(
--                    'Content-Type',  'application/json',
--                    'Authorization', 'Bearer ' || current_setting('app.cron_secret', true)
--                  ),
--       body    := jsonb_build_object('source', 'pg_cron')::text
--     );
--     $$
--   );
--
-- Inspect / pause / unschedule:
--   SELECT * FROM cron.job;
--   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--   SELECT cron.alter_job(job_id := <id>, active := false);
--   SELECT cron.unschedule('kitabuyetu-every-5-min');
-- =============================================================================
