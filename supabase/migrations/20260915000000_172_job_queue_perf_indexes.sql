-- =============================================================================
-- 172_job_queue_perf_indexes.sql
-- Two indexes for job_queue, both confirmed by the 2026-09 optimization audit
-- (docs/audits/optimization-2026-09/verified/background-job-engine-*.json).
--
-- idx_job_queue_claim: claimPendingJobs' typed branch (lib/jobs/db.ts) and
-- getJobQueueSnapshot's GROUP BY both filter on `type` in addition to
-- `status = 'pending'`. The only existing pending-row index
-- (idx_job_queue_pick, priority DESC, run_at) has no `type` column, so a
-- single-row typed claim degenerated into a scan of the whole pending set —
-- measured live at up to 10,815 buffers for one row against a ~19,700-row
-- backlog. This index lets the planner seek on type directly.
--
-- idx_job_queue_prune: pruneOldJobs' DELETE (status IN ('completed','failed')
-- AND updated_at < cutoff) had no matching index and ran a full sequential
-- scan — confirmed live via EXPLAIN, matching pg_stat_statements exactly
-- (48 calls, mean 1,171ms, max 7,850ms over a 121-day window). Low severity
-- on its own (it was firing 12x/month instead of once — see migration to
-- lib/jobs/index.ts's cleanup_old_jobs dedup key — not "every tick" as
-- originally overstated), but cheap to fix properly at the same time.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_job_queue_claim
  ON job_queue (type, priority DESC, run_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_job_queue_prune
  ON job_queue (updated_at)
  WHERE status IN ('completed', 'failed');
