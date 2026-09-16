/**
 * Raw SQL operations for the job queue.
 * Uses the shared pg Pool directly (no RLS context needed — job queue
 * is admin-only; the postgres superuser has BYPASSRLS).
 */
import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import type { Job, JobStatus, JobType, EnqueueOptions } from "./types";

/** A pg Pool or a transaction-bound PoolClient — anything with `.query`. */
type Queryable = Pick<PoolClient, "query">;

/**
 * Atomically claim the next batch of pending jobs using
 * `FOR UPDATE SKIP LOCKED` — safe for concurrent Vercel invocations.
 *
 * `onlyType` lets processJobBatch round-robin across every distinct pending
 * type instead of always draining by strict `priority DESC`. A per-type cap
 * within priority-ordered claiming turned out not to be enough on its own
 * (confirmed in prod): several job types share the same priority tier
 * (sms_process_schedules, 3 email_campaign_* types, payment_requests_expire
 * are all priority 5), so even capped at a few each, that tier alone can
 * fill an entire tick's time budget before a lower-priority type like
 * sms_poll_dlr (priority 4) or sms_release_stale_reservations (priority 3)
 * is ever reached — they made zero progress for hours even after that cap
 * shipped. Restricting a claim to one specific type is what lets the
 * processor guarantee every distinct pending type gets touched once per
 * round before any type gets a second job.
 */
export async function claimPendingJobs(
  limit = 10,
  onlyType?: JobType,
): Promise<Job[]> {
  // Split into two statements rather than one query with
  // `($2::text IS NULL OR type = $2)` — that disjunction isn't sargable, so
  // the planner can't seek on `type` and falls back to scanning the pending
  // set from the front of the priority order, filtering as it goes. Measured
  // live at up to 10,815 buffers / 16.9ms for a single-row claim against a
  // ~19,700-row backlog (docs/audits/optimization-2026-09). The typed branch
  // below lets idx_job_queue_claim (type, priority DESC, run_at) serve the
  // claim directly.
  const { rows } = onlyType
    ? await pool.query<Job>(
        `UPDATE job_queue
         SET    status     = 'processing',
                updated_at = NOW()
         WHERE  id IN (
           SELECT id
           FROM   job_queue
           WHERE  status = 'pending'
             AND  run_at <= NOW()
             AND  type = $2
           ORDER  BY priority DESC, run_at ASC
           LIMIT  $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limit, onlyType],
      )
    : await pool.query<Job>(
        `UPDATE job_queue
         SET    status     = 'processing',
                updated_at = NOW()
         WHERE  id IN (
           SELECT id
           FROM   job_queue
           WHERE  status = 'pending'
             AND  run_at <= NOW()
           ORDER  BY priority DESC, run_at ASC
           LIMIT  $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limit],
      );
  return rows;
}

export interface JobQueueSnapshot {
  /**
   * Every distinct job type with pending, due work right now, ordered by its
   * own highest priority — purely a claiming preference within a round (see
   * processJobBatch). Each type here gets exactly one claim attempt before
   * any type gets a second.
   */
  priorityOrderedTypes: JobType[];
  /** Total pending and due right now. */
  pending: number;
  /** Age of the oldest due job, in minutes. 0 when the queue is empty. */
  oldestPendingMins: number;
  /** Per-type breakdown, worst (oldest) first, for the tick's log line. */
  byType: { type: JobType; pending: number; oldestMins: number }[];
}

/**
 * One tick's-worth of job-queue introspection: the round-robin claim order
 * AND the queue-depth/starvation metrics, from a single GROUP BY scan.
 *
 * Previously two separate queries (getDistinctPendingTypes + getQueueDepth)
 * ran back-to-back over the same `status='pending' AND run_at<=NOW()` rows
 * every tick. Measured live: the first pays the full scan cost (~931ms
 * against a ~19,700-row backlog) and the second — identical shape, same
 * rows, still warm — costs ~15ms. Billing both separately overstated the
 * "introspection tax" by 2x and did two scans where Postgres only needed one
 * (docs/audits/optimization-2026-09). `idx_job_queue_claim` makes this an
 * index-only scan once the backlog is small, same index that serves
 * claimPendingJobs' typed branch.
 *
 * `run_at <= NOW()` deliberately: a job scheduled for the future is not a
 * backlog, and counting it would make every healthy tick look alarming.
 */
export async function getJobQueueSnapshot(): Promise<JobQueueSnapshot> {
  const { rows } = await pool.query<{
    type: JobType;
    priority: number;
    pending: string;
    oldest_mins: string;
  }>(
    `SELECT type,
            MAX(priority)                                                AS priority,
            COUNT(*)::text                                                AS pending,
            (EXTRACT(EPOCH FROM (NOW() - MIN(run_at))) / 60)::int::text  AS oldest_mins
       FROM job_queue
      WHERE status = 'pending' AND run_at <= NOW()
      GROUP BY type
      ORDER BY priority DESC`,
  );

  const byType = rows
    .map((r) => ({
      type: r.type,
      pending: Number(r.pending),
      oldestMins: Number(r.oldest_mins),
    }))
    // Worst (oldest) first for the tick's log line — independent of the
    // priority ordering above, which only matters for claim order.
    .sort((a, b) => b.oldestMins - a.oldestMins);

  return {
    priorityOrderedTypes: rows.map((r) => r.type),
    pending: byType.reduce((sum, t) => sum + t.pending, 0),
    oldestPendingMins:
      byType.length > 0 ? Math.max(...byType.map((t) => t.oldestMins)) : 0,
    byType,
  };
}

/**
 * Reset jobs that have been stuck in 'processing' longer than the
 * threshold (safeguard against Vercel function timeouts).
 *
 * Counts the timeout as an attempt. Previously this only flipped the status
 * back to 'pending' and left `attempts` untouched — but `attempts` is
 * incremented *only* in processSingleJob's catch branch, which a timed-out
 * invocation never reaches (the function died; nothing threw). A job that
 * reliably exceeds the function budget was therefore reset forever, never
 * approaching max_attempts.
 *
 * For `sms_bulk_send` that loop is not merely wasteful: each pass re-runs
 * debitPayer and re-inserts log rows, so it re-bills and re-sends the whole
 * campaign indefinitely (SMS_MESSAGING_AUDIT_2026-08.md H3). It was harmless
 * only while C1 made billing throw before any of it ran; repairing C1 armed it.
 *
 * A job that exhausts its attempts here is marked 'failed' rather than
 * released again, matching what the catch branch does on a thrown error.
 * This bounds the retry loop; it does NOT make a retried campaign stop
 * re-billing what it already billed — that needs a dispatch-level idempotency
 * key and is tracked with the credit-reservation work (SMS-007/SMS-015,
 * docs/messaging/UNIFIED_MESSAGING_ARCHITECTURE.md Phase 2/3).
 */
export async function resetStuckJobs(
  thresholdMinutes = 6,
): Promise<{ released: number; failed: number }> {
  const { rows } = await pool.query<{ status: JobStatus }>(
    `UPDATE job_queue
     SET    attempts   = attempts + 1,
            status     = CASE
                           WHEN attempts + 1 >= max_attempts THEN 'failed'
                           ELSE 'pending'
                         END,
            last_error = 'Timed out in processing; reset by stuck-job sweep',
            updated_at = NOW()
     WHERE  status     = 'processing'
       AND  updated_at < NOW() - ($1 || ' minutes')::INTERVAL
     RETURNING status`,
    [thresholdMinutes],
  );

  return {
    released: rows.filter((r) => r.status === "pending").length,
    failed: rows.filter((r) => r.status === "failed").length,
  };
}

export async function markJobCompleted(id: string): Promise<void> {
  await pool.query(
    `UPDATE job_queue
     SET status = 'completed', updated_at = NOW()
     WHERE id = $1`,
    [id],
  );
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE job_queue
     SET status = 'failed', last_error = $2, updated_at = NOW()
     WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/**
 * Schedule a retry with exponential backoff.
 * Resets status to 'pending' so the job is picked up in a future tick.
 */
export async function scheduleRetry(
  id: string,
  attempts: number,
  delaySecs: number,
  error: string,
): Promise<void> {
  await pool.query(
    `UPDATE job_queue
     SET status     = 'pending',
         attempts   = $2,
         last_error = $3,
         run_at     = NOW() + ($4 || ' seconds')::INTERVAL,
         updated_at = NOW()
     WHERE id = $1`,
    [id, attempts, error.slice(0, 2000), delaySecs],
  );
}

/**
 * Append a log entry for a job execution.
 * Fire-and-forget safe — does not throw if it fails.
 */
export async function logJob(
  jobId: string,
  status: JobStatus | "retried" | "started",
  message: string,
  durationMs?: number,
): Promise<void> {
  await pool
    .query(
      `INSERT INTO job_logs (job_id, status, message, duration_ms)
     VALUES ($1, $2, $3, $4)`,
      [jobId, status, message.slice(0, 4000), durationMs ?? null],
    )
    .catch(() => {
      // Log write failure must never crash the processor
    });
}

/**
 * Enqueue a job, silently skipping duplicates via the dedup_key partial index.
 * Returns the new job's ID, or null if skipped (duplicate).
 *
 * Pass `executor` to run the INSERT on a caller's open transaction (a
 * PoolClient) instead of the shared pool. This lets a producer commit the
 * enqueue atomically with its own state change — e.g. the SMS scheduler
 * advances a schedule and enqueues its send in one transaction, so neither can
 * happen without the other. Defaults to the shared pool (its own connection).
 */
export async function insertJob(
  type: JobType,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  executor: Queryable = pool,
): Promise<string | null> {
  const {
    priority = 0,
    run_at = new Date(),
    max_attempts = 5,
    dedup_key,
  } = opts;

  const { rows } = await executor.query<{ id: string }>(
    `INSERT INTO job_queue (type, payload, priority, run_at, max_attempts, dedup_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (dedup_key)
       WHERE dedup_key IS NOT NULL
         AND status NOT IN ('completed', 'failed')
     DO NOTHING
     RETURNING id`,
    [
      type,
      JSON.stringify(payload),
      priority,
      run_at,
      max_attempts,
      dedup_key ?? null,
    ],
  );
  return rows[0]?.id ?? null;
}

/**
 * Delete completed/failed jobs older than `days` days.
 * Called from the cleanup job to prevent unbounded table growth.
 */
export async function pruneOldJobs(days = 30): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM job_queue
     WHERE status IN ('completed', 'failed')
       AND updated_at < NOW() - ($1 || ' days')::INTERVAL`,
    [days],
  );
  return rowCount ?? 0;
}

/**
 * job_logs has no retention of its own — pruneOldJobs only ever deletes the
 * *job_queue* row (job_logs then cascades via job_logs_job_id_fkey), so a
 * job still inside its 30-day retention window keeps accumulating "started"/
 * "completed" log rows indefinitely across every retry. Measured live:
 * 451,892 inserts, 0 updates, 58MB, with 'started' alone 51.6% of rows and
 * zero application code reading the table by id (docs/audits/
 * optimization-2026-09).
 *
 * 'failed' and 'retried' rows are kept regardless of age — they're the only
 * rows with real diagnostic content and the ones an operator would actually
 * want after a week.
 */
export async function pruneOldJobLogs(days = 7): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM job_logs
     WHERE status IN ('started', 'completed')
       AND created_at < NOW() - ($1 || ' days')::INTERVAL`,
    [days],
  );
  return rowCount ?? 0;
}
