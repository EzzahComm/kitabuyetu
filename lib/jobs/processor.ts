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
import type { Job, JobType, ProcessResult } from './types';
import { logger } from '@/lib/logger';
import { setTickDeadline } from './deadline';
import {
  claimPendingJobs,
  getDistinctPendingTypes,
  resetStuckJobs,
  markJobCompleted,
  markJobFailed,
  scheduleRetry,
  logJob,
} from './db';
import { handleJob } from './handlers';

/**
 * Ceiling on jobs claimed per tick. Raised from 25 alongside TIME_BUDGET_MS
 * below — 25 was never the binding constraint (the 7-second budget stopped a
 * tick long before it), so lifting the budget without lifting this would just
 * move the bottleneck one step along.
 */
const BATCH_SIZE = 100;

/**
 * Hard ceiling on this function's own wall-clock budget, independent of
 * whatever the actual Vercel function timeout is. Leaves headroom for the
 * claim query, logging, and one in-flight job to finish cleanly rather than
 * being killed mid-write by the platform.
 *
 * Before this existed, claimPendingJobs(10) claimed a whole batch up front
 * (marking all 10 'processing') and then awaited them one at a time with no
 * time check at all. Whenever the batch's total real time — dominated by
 * jobs making outbound HTTP calls, e.g. sms_poll_dlr's provider lookups —
 * exceeded the function's actual ceiling, the platform killed the invocation
 * mid-batch. Whatever hadn't finished sat in 'processing' limbo for a full
 * 6 minutes until resetStuckJobs reclaimed it, then collided with the exact
 * same timeout on the next tick.
 *
 * RAISED FROM 7s TO 50s ON 2026-08-27. The 7-second figure was chosen when
 * this code assumed a 10-second Hobby ceiling, and that assumption is simply
 * out of date: Vercel's default function timeout is now 300s, and
 * /api/cron now pins `maxDuration = 60` explicitly rather than inheriting a
 * default that can move under it.
 *
 * 7 seconds was starving the queue outright. Measured in production the same
 * day: a tick completed TWO jobs before its budget expired, against ~12
 * distinct pending types — so with round-robin, most types waited several
 * ticks for a turn and arrival outpaced throughput continuously. The queue
 * had reached 11,505 pending with the oldest row nine days old, and a
 * single-job type (one scheduled campaign) sat unclaimed behind three email
 * backlogs of ~2,500 each.
 *
 * 50s inside a 60s ceiling keeps the original safety property — a tick still
 * stops itself well before the platform can kill it mid-write — while giving
 * roughly seven times the work per tick. Cron fires every 5 minutes, so even
 * a full-length tick finishes with 250s to spare.
 */
const TIME_BUDGET_MS = 50_000;

/**
 * Do not START another job unless at least this much of the tick remains.
 *
 * The budget check above is only consulted BEFORE claiming, so on its own a
 * job claimed at 49.9s still runs with ~10s before the platform's 60s ceiling
 * (Vercel Hobby's hard maximum — see lib/jobs/deadline.ts). Refusing to claim
 * inside the last stretch means a job always begins with a usable slice, and
 * the long SMS loops additionally stop themselves as the deadline nears.
 *
 * Whatever is not claimed is simply left pending for the next tick five
 * minutes later, which is the same outcome the budget check already produces.
 */
const MIN_JOB_BUDGET_MS = 10_000;

/**
 * Claim and process pending jobs in round-robin rounds across every distinct
 * pending type, stopping once BATCH_SIZE is reached or TIME_BUDGET_MS has
 * elapsed — never claims a job it may not get to run. Safe to call
 * concurrently — `FOR UPDATE SKIP LOCKED` on each single-row claim prevents
 * double processing.
 *
 * A first attempt at fairness capped how many jobs of the SAME type could be
 * claimed per tick, still claiming by strict `priority DESC` otherwise —
 * confirmed NOT enough in prod: several types share the same priority tier
 * (sms_process_schedules + 3 email_campaign_* types + payment_requests_expire
 * are all priority 5), so that tier alone, each type capped or not, still
 * filled the whole time budget before sms_poll_dlr (priority 4) or
 * sms_release_stale_reservations (priority 3) was ever reached.
 *
 * Plain round-robin (touch every type once per round, in priority order)
 * was ALSO confirmed not enough: prod currently has 18 distinct pending
 * types at once. sms_poll_dlr and sms_release_stale_reservations still
 * showed zero progress even after that shipped, because reaching them in a
 * priority-ordered round means getting through every higher-priority type's
 * real job first (several make outbound HTTP calls — email/SMS provider
 * APIs), and that alone can exceed the whole time budget before their turn
 * ever comes, tick after tick, forever — priority order never changes which
 * types sit at the back.
 *
 * ROTATE_STARTING_TYPE fixes that: which type goes first is derived from
 * the current 5-minute tick number, so a different type leads each tick.
 * Every distinct type gets to go first roughly once every
 * (types.length × 5 minutes), and — critically — "roughly" here bounds a
 * PERIOD, not "never": no type can be permanently stuck at the back the way
 * static priority ordering left it.
 */
export async function processJobBatch(): Promise<ProcessResult> {
  const result: ProcessResult = { processed: 0, succeeded: 0, failed: 0, retried: 0 };
  const startedAt = Date.now();
  // Publish this tick's deadline so long-running handlers can bound themselves
  // (lib/jobs/deadline.ts). Cleared in the finally below so a service called
  // outside the job runner never sees a stale one.
  setTickDeadline(startedAt + TIME_BUDGET_MS);
  try {

    // Reset any jobs stuck from a prior timeout before claiming new ones. A
    // timeout now counts as an attempt, so a job that never fits the function
    // budget eventually fails permanently instead of looping (and, for
    // sms_bulk_send, re-billing) forever.
    const { released, failed } = await resetStuckJobs(6);
    if (released > 0) {
      logger.warn(`[jobs] Released ${released} stuck job(s) back to pending`);
    }
    if (failed > 0) {
      result.failed += failed;
      logger.error(`[jobs] ${failed} stuck job(s) exhausted max_attempts and were failed`);
    }

    const priorityOrderedTypes = await getDistinctPendingTypes();
    const types = rotateStartingType(priorityOrderedTypes, startedAt);

    outer: while (types.length > 0 && result.processed < BATCH_SIZE) {
      let claimedAnyThisRound = false;

      for (const type of types) {
        if (result.processed >= BATCH_SIZE) break outer;
        if (Date.now() - startedAt >= TIME_BUDGET_MS - MIN_JOB_BUDGET_MS) {
          logger.warn(`[jobs] Time budget reached after ${result.processed} job(s); leaving the rest for the next tick`);
          break outer;
        }

        const [job] = await claimPendingJobs(1, type);
        if (!job) continue; // this type ran dry mid-tick — skip it for the rest of this round

        claimedAnyThisRound = true;
        result.processed++;
        await processSingleJob(job, result);
      }

      if (!claimedAnyThisRound) break; // nothing left across any type
    }

    return result;
  } finally {
    setTickDeadline(null);
  }
}

const TICK_INTERVAL_MS = 5 * 60 * 1000; // matches enqueueTimeBasedJobs' pg_cron cadence

/**
 * Rotates `types` so a different type leads each 5-minute tick, instead of
 * always starting from priority order. See processJobBatch's header for why
 * this — not just round-robining within a tick — is what guarantees no type
 * is starved forever.
 */
function rotateStartingType(types: JobType[], now: number): JobType[] {
  if (types.length === 0) return types;
  const tick = Math.floor(now / TICK_INTERVAL_MS);
  const offset = tick % types.length;
  return [...types.slice(offset), ...types.slice(0, offset)];
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
