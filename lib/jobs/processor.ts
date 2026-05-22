/**
 * Job processor — orchestrates fetch → lock → execute → status update.
 *
 * Retry / backoff strategy (exponential):
 *   attempt 1 →  2^1 × 60 s =  2 min
 *   attempt 2 →  2^2 × 60 s =  4 min
 *   attempt 3 →  2^3 × 60 s =  8 min
 *   attempt 4 →  2^4 × 60 s = 16 min
 *   attempt 5 →  permanently failed (max_attempts default = 5)
 *
 * Stuck-job safeguard:
 *   Jobs left in 'processing' for > 6 min are reset to 'pending'.
 *   This handles Vercel Hobby function timeouts (10 s limit).
 */
import type { Job, ProcessResult } from './types';
import { logger } from '@/lib/logger';
import {
  claimPendingJobs,
  resetStuckJobs,
  markJobCompleted,
  markJobFailed,
  scheduleRetry,
  logJob,
} from './db';
import { handleJob } from './handlers';

const BATCH_SIZE = 10;

/**
 * Claim and process the next batch of pending jobs.
 * Safe to call concurrently — `FOR UPDATE SKIP LOCKED` prevents double processing.
 */
export async function processJobBatch(): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, succeeded: 0, failed: 0, retried: 0 };

  // Reset any jobs stuck from a prior timeout before claiming new ones
  const reset = await resetStuckJobs(6);
  if (reset > 0) {
    logger.warn(`[jobs] Reset ${reset} stuck job(s) to pending`);
  }

  const jobs = await claimPendingJobs(BATCH_SIZE);

  for (const job of jobs) {
    result.processed++;
    await processSingleJob(job, result);
  }

  return result;
}

async function processSingleJob(job: Job, result: ProcessResult): Promise<void> {
  const startedAt = Date.now();

  await logJob(job.id, 'started', `Starting ${job.type} (attempt ${job.attempts + 1}/${job.max_attempts})`);

  try {
    const handlerResult = await handleJob(job);
    const durationMs = Date.now() - startedAt;

    await markJobCompleted(job.id);
    await logJob(job.id, 'completed', handlerResult.message, durationMs);

    result.succeeded++;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const error      = err instanceof Error ? err.message : String(err);
    const newAttempts = job.attempts + 1;

    if (newAttempts >= job.max_attempts) {
      await markJobFailed(job.id, error);
      await logJob(
        job.id,
        'failed',
        `Permanently failed after ${newAttempts} attempt(s): ${error}`,
        durationMs,
      );
      result.failed++;

      logger.error(`[jobs] Job ${job.id} (${job.type}) permanently failed`, { jobId: job.id, type: job.type, error });
    } else {
      // Exponential backoff: 2^attempts * 60 seconds
      const delaySecs = Math.pow(2, newAttempts) * 60;
      await scheduleRetry(job.id, newAttempts, delaySecs, error);
      await logJob(
        job.id,
        'retried',
        `Attempt ${newAttempts} failed, retrying in ${delaySecs}s: ${error}`,
        durationMs,
      );
      result.retried++;

      logger.warn(`[jobs] Job ${job.id} (${job.type}) failed, retry in ${delaySecs}s`, { jobId: job.id, type: job.type, delaySecs, error });
    }
  }
}
