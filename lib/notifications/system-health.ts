/**
 * Availability and failure monitoring → administrator alerts.
 *
 * Two layers, because no in-app monitor can report its own total outage:
 *
 *  1. In-app (this file). A 5-minute job checks the database, Redis, the job
 *     queue, the SMS circuit breaker and the M-Pesa callback backlog, and
 *     records a heartbeat. When the job resumes after a gap (the app or its
 *     scheduler was down) it reports the outage retroactively. A sliding
 *     window of server errors raises an ERROR_SPIKE.
 *  2. External. Point an uptime monitor (UptimeRobot, Better Stack, Vercel
 *     alerts…) at GET /api/health (public liveness) and /api/health/deep
 *     (DB+Redis, x-worker-secret header) and route ITS alerts to
 *     KITABU_ADMIN_ALERT_PHONE/EMAIL. That is the only thing that can report
 *     "the whole app is unreachable" in real time.
 *
 * Alerts are de-duplicated per failing condition per hour; recovery is
 * reported once.
 */
import { pool, withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { canAttempt } from '@/lib/sms/circuit-breaker';
import { activeSmsProvider } from '@/lib/sms/provider';
import { ActivityEventType } from './activity-events';
import { emitActivity } from './activity-notifier';

const HEARTBEAT_KEY = 'system_health_heartbeat';
const GAP_MINUTES = 20; // job runs every 5 min

interface CheckResult {
  check: string;
  ok: boolean;
  type: ActivityEventType;
  detail?: string;
}

const hourBucket = () => new Date().toISOString().slice(0, 13);

async function timed<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

async function checkDatabase(): Promise<CheckResult> {
  const t = Date.now();
  try {
    await timed(async () => {
      const c = await pool.connect();
      try {
        await c.query('SELECT 1');
      } finally {
        c.release();
      }
    }, 5000);
    const ms = Date.now() - t;
    return {
      check: 'database',
      ok: ms < 3000,
      type: ActivityEventType.DATABASE_FAILURE,
      detail: ms >= 3000 ? `slow: ${ms}ms` : undefined,
    };
  } catch (err) {
    return {
      check: 'database',
      ok: false,
      type: ActivityEventType.DATABASE_FAILURE,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkRedis(): Promise<CheckResult> {
  if (!process.env.REDIS_URL) return { check: 'redis', ok: true, type: ActivityEventType.CACHE_FAILURE };
  try {
    const { redis } = await import('@/lib/redis');
    await timed(() => redis.ping(), 4000);
    return { check: 'redis', ok: true, type: ActivityEventType.CACHE_FAILURE };
  } catch (err) {
    return {
      check: 'redis',
      ok: false,
      type: ActivityEventType.CACHE_FAILURE,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkJobs(): Promise<CheckResult[]> {
  const { rows } = await withAdminDb((db) =>
    db.query<{ stalled: string; oldest_min: string | null; failed_1h: string }>(
      `SELECT COUNT(*) FILTER (WHERE status = 'pending' AND run_at < NOW() - INTERVAL '30 minutes')::text AS stalled,
              (EXTRACT(EPOCH FROM (NOW() - MIN(run_at) FILTER (WHERE status = 'pending' AND run_at < NOW() - INTERVAL '30 minutes'))) / 60)::text AS oldest_min,
              COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '1 hour')::text AS failed_1h
       FROM job_queue
       WHERE status IN ('pending','failed')`,
    ),
  );
  const stalled = Number(rows[0]?.stalled ?? 0);
  const failed = Number(rows[0]?.failed_1h ?? 0);
  return [
    {
      check: 'job_queue',
      ok: stalled === 0,
      type: ActivityEventType.JOB_QUEUE_STALLED,
      detail: stalled
        ? `${stalled} job(s) overdue by 30+ min (oldest ~${Math.round(Number(rows[0]?.oldest_min ?? 0))} min) — the scheduler may not be running`
        : undefined,
    },
    {
      check: 'job_failures',
      ok: failed < 10,
      type: ActivityEventType.JOB_FAILURES,
      detail: failed >= 10 ? `${failed} background jobs failed permanently in the last hour` : undefined,
    },
  ];
}

async function checkCallbacks(): Promise<CheckResult> {
  const { rows } = await withAdminDb((db) =>
    db.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM mpesa_callbacks
       WHERE NOT processed AND created_at < NOW() - INTERVAL '20 minutes' AND created_at > NOW() - INTERVAL '2 days'`,
    ),
  );
  const n = Number(rows[0]?.n ?? 0);
  return {
    check: 'mpesa_callbacks',
    ok: n < 5,
    type: ActivityEventType.PAYMENT_CALLBACK_FAILURE,
    detail: n >= 5 ? `${n} M-Pesa callbacks unprocessed for 20+ minutes — payments may not be crediting` : undefined,
  };
}

function checkSms(): CheckResult {
  const ok = canAttempt(activeSmsProvider());
  return {
    check: 'sms_provider',
    ok,
    type: ActivityEventType.SMS_PROVIDER_FAILURE,
    detail: ok ? undefined : `Circuit breaker open for ${activeSmsProvider()} — SMS sending is failing fast`,
  };
}

async function recordResult(r: CheckResult): Promise<void> {
  if (!r.ok) {
    await emitActivity({
      type: r.type,
      description: r.detail,
      dedupKey: `sys:${r.check}:down:${hourBucket()}`,
      metadata: { check: r.check },
    });
    return;
  }
  // Recovery: look at the newest event for this check of any failure type.
  const { rows } = await withAdminDb((db) =>
    db.query<{ id: string; event_type: string }>(
      `SELECT id, event_type FROM platform_activity_logs
       WHERE metadata->>'check' = $1 ORDER BY created_at DESC LIMIT 1`,
      [r.check],
    ),
  );
  const last = rows[0];
  if (last && last.event_type !== ActivityEventType.SYSTEM_RECOVERED) {
    await emitActivity({
      type: ActivityEventType.SYSTEM_RECOVERED,
      description: `${r.check.replace(/_/g, ' ')} is healthy again.`,
      dedupKey: `sys:${r.check}:recovered:${last.id}`,
      metadata: { check: r.check },
    });
  }
}

/** Retroactive downtime detection from the heartbeat gap. */
async function checkHeartbeat(): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query<{ last: string | null }>(`SELECT last_checked_at AS last FROM staff_alert_state WHERE alert_key = $1`, [
      HEARTBEAT_KEY,
    ]),
  );
  const last = rows[0]?.last ? new Date(rows[0].last).getTime() : null;
  await withAdminDb((db) =>
    db.query(
      `INSERT INTO staff_alert_state (alert_key, fingerprint, last_alerted_at, last_checked_at, updated_at)
       VALUES ($1, NULL, NULL, NOW(), NOW())
       ON CONFLICT (alert_key) DO UPDATE SET last_checked_at = NOW(), updated_at = NOW()`,
      [HEARTBEAT_KEY],
    ),
  );
  if (last && Date.now() - last > GAP_MINUTES * 60_000) {
    const mins = Math.round((Date.now() - last) / 60_000);
    await emitActivity({
      type: ActivityEventType.SYSTEM_DOWNTIME,
      description: `Platform monitoring did not run for about ${mins} minutes (${new Date(last).toISOString()} to now). The app or its scheduler was likely unavailable; it is running again.`,
      dedupKey: `sys:heartbeat-gap:${new Date(last).toISOString().slice(0, 16)}`,
      metadata: { check: 'heartbeat', gapMinutes: mins },
    });
  }
}

export async function runSystemHealthCheck(): Promise<{ failing: string[] }> {
  const results: CheckResult[] = [];
  results.push(await checkDatabase());
  if (!results[0].ok) {
    // Cannot query the rest without a database; alert now (direct fallback covers persistence failure).
    await recordResult(results[0]).catch(() => {});
    return { failing: ['database'] };
  }
  await checkHeartbeat().catch((e) => logger.warn('[system-health] heartbeat failed', { err: String(e) }));
  results.push(await checkRedis());
  results.push(checkSms());
  for (const fn of [checkJobs, checkCallbacks]) {
    try {
      const r = await fn();
      results.push(...(Array.isArray(r) ? r : [r]));
    } catch (err) {
      logger.warn('[system-health] check failed to run', { err: String(err) });
    }
  }
  for (const r of results) await recordResult(r).catch(() => {});
  return { failing: results.filter((r) => !r.ok).map((r) => r.check) };
}

// ── Server error spike (in-memory, per instance) ─────────────────────────────

const WINDOW_MS = 5 * 60_000;
const SPIKE_THRESHOLD = 25;
const errorTimes: number[] = [];
let reentrant = false;

/** Called by the error sink for every logger.error. Cheap, synchronous, never throws. */
export function noteServerError(): void {
  if (reentrant) return;
  const now = Date.now();
  errorTimes.push(now);
  while (errorTimes.length && now - errorTimes[0] > WINDOW_MS) errorTimes.shift();
  if (errorTimes.length >= SPIKE_THRESHOLD) {
    const count = errorTimes.length;
    errorTimes.length = 0;
    reentrant = true;
    void emitActivity({
      type: ActivityEventType.ERROR_SPIKE,
      description: `${count} server errors in under 5 minutes on one instance.`,
      dedupKey: `sys:error-spike:${new Date(now).toISOString().slice(0, 15)}`, // 10-minute buckets
      metadata: { check: 'error_spike', errors: count },
    }).finally(() => {
      reentrant = false;
    });
  }
}

export function resetErrorWindow(): void {
  errorTimes.length = 0;
  reentrant = false;
}
