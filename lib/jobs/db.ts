/**
 * Raw SQL operations for the job queue.
 * Uses the shared pg Pool directly (no RLS context needed — job queue
 * is admin-only; the postgres superuser has BYPASSRLS).
 */
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db';
import type { Job, JobStatus, JobType, EnqueueOptions } from './types';

/** A pg Pool or a transaction-bound PoolClient — anything with `.query`. */
type Queryable = Pick<PoolClient, 'query'>;

/**
 * Atomically claim the next batch of pending jobs using
 * `FOR UPDATE SKIP LOCKED` — safe for concurrent Vercel invocations.
 */
export async function claimPendingJobs(limit = 10): Promise<Job[]> {
  const { rows } = await pool.query<Job>(
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
    released: rows.filter((r) => r.status === 'pending').length,
    failed:   rows.filter((r) => r.status === 'failed').length,
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
  id:        string,
  attempts:  number,
  delaySecs: number,
  error:     string,
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
  jobId:      string,
  status:     JobStatus | 'retried' | 'started',
  message:    string,
  durationMs?: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO job_logs (job_id, status, message, duration_ms)
     VALUES ($1, $2, $3, $4)`,
    [jobId, status, message.slice(0, 4000), durationMs ?? null],
  ).catch(() => {
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
  type:     JobType,
  payload:  Record<string, unknown>,
  opts:     EnqueueOptions = {},
  executor: Queryable = pool,
): Promise<string | null> {
  const {
    priority     = 0,
    run_at       = new Date(),
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
    [type, JSON.stringify(payload), priority, run_at, max_attempts, dedup_key ?? null],
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
