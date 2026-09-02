/**
 * SMS provider health sampling and staff alerting (SMS-AUDIT-v3 T3-4 / G14).
 *
 * The gap this closes, stated plainly: nothing in this platform has ever
 * noticed that SMS stopped working. The 401 outage on 2026-08-27 failed every
 * welcome message to eight members, burned their append-only trigger
 * executions permanently, and was found days later by a human reading the
 * database. `findSpineOrphans()` in outbox.service.ts calls its own
 * `logger.error` "the paging signal" — but no sink consumes logger.error, so
 * it pages nobody. This module is the first thing here that actually tells a
 * person something is wrong.
 *
 * ── Why the DB and not the circuit breaker ──
 * lib/sms/circuit-breaker.ts holds PER-INSTANCE state and says so in its own
 * header: on serverless, several instances each hold their own view, so it
 * cannot answer "is the provider down for everyone". `sms_usage_logs` can —
 * it is the one place every instance's outcome lands. The breaker protects a
 * single invocation from grinding; this protects the humans from silence.
 *
 * ── Never over SMS ──
 * An alert about a broken SMS channel must not be delivered over that
 * channel. Email + the log line only. This mirrors the low-balance alert's
 * own rule and is stated in the pathway doc's closure test.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { queueEmail } from './email.service';
import { DEFAULT_SMS_PROVIDER } from '@/lib/sms/provider';

/** How far back a sample looks. Matches the hourly job cadence. */
const SAMPLE_WINDOW = '1 hour';

/**
 * Below this many messages in the window, no verdict is issued at all.
 *
 * A single failed send out of one attempt is a 100% failure rate and means
 * nothing — most groups send in bursts with long idle gaps, so a low-volume
 * window is normal, not evidence. Paging on it would train whoever receives
 * these to ignore them, which is worse than not sending them.
 */
const MIN_SAMPLE = 10;

/**
 * Failure rate that counts as degraded.
 *
 * Set high on purpose. The failure mode worth waking someone for is the one
 * this system has actually suffered twice — a credential or endpoint fault
 * where EVERY send fails (the 401 outage: 100%; the DLR misread: 100%). A
 * lower threshold would fire on ordinary invalid-number noise, which is a
 * per-recipient data problem, not an outage.
 */
const DEGRADED_RATE = 0.5;

/**
 * Minimum gap between alerts for the same provider while it stays degraded.
 *
 * The closure test is "exactly one alert raised, not one per message". The
 * claim-by-UPDATE below is what enforces that; this is how long the claim
 * holds. Six hours, so a long outage re-reminds rather than either spamming
 * hourly or going quiet forever.
 */
const ALERT_COOLOFF = '6 hours';

export interface HealthSample {
  provider:    string;
  total:       number;
  failed:      number;
  failureRate: number;
  /** null when the window held too few messages to judge. */
  state:       'healthy' | 'degraded' | null;
  alerted:     boolean;
  recovered:   boolean;
}

/**
 * Sample the recent failure rate, persist the verdict, and alert staff on a
 * transition into degraded.
 *
 * Returns rather than throws for every outcome a caller might care about, so
 * the job handler can report it in the run record. Genuinely unexpected
 * errors do propagate — the job queue's retry is the right owner for those.
 */
export async function sampleProviderHealth(
  provider: string = DEFAULT_SMS_PROVIDER,
): Promise<HealthSample> {
  const [counts] = await withAdminDb((db) =>
    db.query<{ total: string; failed: string }>(
      // Only rows that reached a provider verdict are eligible. 'queued' means
      // the dispatch has not answered yet and 'suppressed' never went out —
      // counting either would make a busy queue look like an outage.
      `SELECT COUNT(*)::text                                        AS total,
              COUNT(*) FILTER (WHERE status = 'failed')::text       AS failed
         FROM sms_usage_logs
        WHERE provider = $1
          AND created_at >= NOW() - INTERVAL '${SAMPLE_WINDOW}'
          AND status IN ('sent', 'delivered', 'failed')`,
      [provider],
    ).then((r) => r.rows),
  );

  const total  = Number(counts?.total ?? 0);
  const failed = Number(counts?.failed ?? 0);
  const failureRate = total > 0 ? failed / total : 0;

  // Too little traffic to judge. Record that we looked — an operator reading
  // last_checked_at should be able to tell "healthy" from "nobody checked" —
  // but issue no verdict and never alert.
  if (total < MIN_SAMPLE) {
    await touchChecked(provider, total, failed);
    return { provider, total, failed, failureRate, state: null, alerted: false, recovered: false };
  }

  const state: 'healthy' | 'degraded' = failureRate >= DEGRADED_RATE ? 'degraded' : 'healthy';

  if (state === 'healthy') {
    const recovered = await markHealthy(provider, total, failed);
    if (recovered) {
      logger.warn('[sms-health] provider recovered', { provider, total, failed });
    }
    return { provider, total, failed, failureRate, state, alerted: false, recovered };
  }

  // Degraded. Claim the right to alert by moving last_alerted_at — only the
  // caller whose UPDATE actually matches a row gets to notify, so two
  // concurrent runs cannot both send.
  const claimed = await claimAlert(provider, total, failed);

  // The log line fires on every degraded sample whether or not the alert was
  // claimed: it is the record of the condition, not the notification.
  logger.error('[sms-health] SMS provider is DEGRADED', {
    provider, total, failed, failureRate: Number(failureRate.toFixed(4)), alerting: claimed,
  });

  if (claimed) await notifyStaff(provider, total, failed, failureRate);

  return { provider, total, failed, failureRate, state, alerted: claimed, recovered: false };
}

async function touchChecked(provider: string, total: number, failed: number): Promise<void> {
  await withAdminDb((db) =>
    db.query(
      `INSERT INTO sms_provider_health_state (provider, last_checked_at, sample_total, sample_failed, updated_at)
       VALUES ($1, NOW(), $2, $3, NOW())
       ON CONFLICT (provider) DO UPDATE
         SET last_checked_at = NOW(), sample_total = $2, sample_failed = $3, updated_at = NOW()`,
      [provider, total, failed],
    ),
  );
}

/**
 * Record a healthy sample. Returns true only on the degraded → healthy
 * transition, so a recovery is logged once rather than every hour.
 *
 * Clearing last_alerted_at here is what re-arms the alert: the next incident
 * notifies immediately instead of waiting out a cool-off left over from the
 * previous one. Exactly the defect M1 found in the low-balance alert, which
 * went silent for 24 hours after a top-up because nothing cleared its flag.
 */
async function markHealthy(provider: string, total: number, failed: number): Promise<boolean> {
  const rowCount = await withAdminDb((db) =>
    db.query(
      `UPDATE sms_provider_health_state
          SET state = 'healthy', last_alerted_at = NULL, last_checked_at = NOW(),
              sample_total = $2, sample_failed = $3, updated_at = NOW()
        WHERE provider = $1 AND state = 'degraded'`,
      [provider, total, failed],
    ).then((r) => r.rowCount ?? 0),
  );

  if (rowCount === 0) {
    // Already healthy (or no row yet) — keep the sample fresh either way.
    await touchChecked(provider, total, failed);
    await withAdminDb((db) =>
      db.query(
        `UPDATE sms_provider_health_state SET state = 'healthy' WHERE provider = $1`,
        [provider],
      ),
    );
  }
  return rowCount > 0;
}

async function claimAlert(provider: string, total: number, failed: number): Promise<boolean> {
  return withAdminDb((db) =>
    db.query(
      `INSERT INTO sms_provider_health_state
         (provider, state, last_alerted_at, last_checked_at, sample_total, sample_failed, updated_at)
       VALUES ($1, 'degraded', NOW(), NOW(), $2, $3, NOW())
       ON CONFLICT (provider) DO UPDATE
         SET state = 'degraded', last_alerted_at = NOW(), last_checked_at = NOW(),
             sample_total = $2, sample_failed = $3, updated_at = NOW()
         WHERE sms_provider_health_state.last_alerted_at IS NULL
            OR sms_provider_health_state.last_alerted_at < NOW() - INTERVAL '${ALERT_COOLOFF}'`,
      [provider, total, failed],
    ).then((r) => (r.rowCount ?? 0) > 0),
  );
}

/**
 * Email the platform admin address. `EMAIL_ADMIN` is already the established
 * staff channel here (billing-email.service.ts CCs it on overdue invoices),
 * so this adds no new dependency and no new secret.
 *
 * Best-effort by construction: failing to warn must never fail the job that
 * noticed. The logger.error above has already recorded the condition.
 */
async function notifyStaff(
  provider: string, total: number, failed: number, failureRate: number,
): Promise<void> {
  const to = process.env.EMAIL_ADMIN;
  if (!to) {
    logger.error('[sms-health] EMAIL_ADMIN is unset — provider alert has no recipient', { provider });
    return;
  }

  await queueEmail({
    to,
    templateKey: 'sms_provider_degraded',
    vars: {
      provider,
      failed,
      total,
      failureRate: `${Math.round(failureRate * 100)}%`,
      window:      SAMPLE_WINDOW,
    },
    referenceType: 'sms_provider_health',
    priority:      'high',
  }).catch((err) => {
    logger.error('[sms-health] failed to queue provider alert email', {
      err: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * The last recorded verdict, for surfaces that must not make a live provider
 * call to answer "is SMS working" — see app/status/page.tsx.
 */
export async function readProviderHealth(
  provider: string = DEFAULT_SMS_PROVIDER,
): Promise<{ state: 'healthy' | 'degraded'; checkedAt: Date | null } | null> {
  const [row] = await withAdminDb((db) =>
    db.query<{ state: 'healthy' | 'degraded'; last_checked_at: Date | null }>(
      `SELECT state, last_checked_at FROM sms_provider_health_state WHERE provider = $1`,
      [provider],
    ).then((r) => r.rows),
  );
  return row ? { state: row.state, checkedAt: row.last_checked_at } : null;
}
