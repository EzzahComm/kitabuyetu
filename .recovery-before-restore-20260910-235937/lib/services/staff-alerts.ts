/**
 * Staff alerting for background controls (SMS-REAUDIT-2026-09-02 F2).
 *
 * The re-audit's headline finding was not a broken control — it was a working
 * one nobody could hear. `sms_credit_reconciliation` correctly detected that a
 * campaign's counters disagreed with its own message log, said so on every run
 * for six days, and reached no human, because `logger.error` has no sink
 * (T3-4 item 1, deferred pending a Sentry decision).
 *
 * This module is the deferral's workaround, not its replacement. It routes a
 * small number of DELIBERATE, high-signal conditions to the staff email
 * address that billing-email.service.ts already uses, with the two properties
 * that decide whether an alert survives contact with a human inbox:
 *
 *   1. **Not once per occurrence.** Alert on the condition, not on each row
 *      inside it — one email saying "1 campaign disagrees", never one per
 *      campaign.
 *   2. **Not once per run.** A problem that persists for six days must not
 *      produce six days of identical email. It re-reminds on an interval
 *      instead, and a CHANGED problem alerts immediately rather than waiting
 *      out a cool-off it did not earn.
 *
 * Sentry is still the better general answer, because it covers every
 * `logger.error` rather than the handful wired here by hand.
 */
import { createHash } from 'crypto';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { queueEmail } from './email.service';

/**
 * How long a persistent, unchanged problem stays quiet before re-reminding.
 *
 * Long on purpose. The condition is already recorded in the job run record and
 * the log line every single run; this interval only governs how often it
 * interrupts somebody. Daily email about an unchanged six-day-old drift is how
 * an alert becomes a filter rule.
 */
const REREMIND_AFTER = '7 days';

export interface StaffAlert {
  /** Stable identity of the condition, e.g. 'sms_credit_reconciliation'. */
  key:     string;
  subject: string;
  /** Plain-text body. Kept plain: this is an operational notice, not comms. */
  body:    string;
  /**
   * What is wrong, in a form that changes when the problem changes. Two runs
   * that produce the same details are the same problem; a different digest
   * earns an immediate alert rather than waiting out the re-reminder window.
   */
  details: unknown;
}

function fingerprintOf(details: unknown): string {
  return createHash('sha256').update(JSON.stringify(details ?? null)).digest('hex').slice(0, 32);
}

/**
 * Claim the right to alert for this condition.
 *
 * Claim-by-UPDATE, the same mechanism raiseLowBalanceAlert uses: only the
 * caller whose write actually matches a row may send, so two concurrent job
 * runs cannot both email. Returns false when this exact condition has already
 * been reported and the re-reminder window has not elapsed.
 */
async function claim(key: string, fingerprint: string): Promise<boolean> {
  return withAdminDb((db) =>
    db.query(
      `INSERT INTO staff_alert_state (alert_key, fingerprint, last_alerted_at, last_checked_at, updated_at)
       VALUES ($1, $2, NOW(), NOW(), NOW())
       ON CONFLICT (alert_key) DO UPDATE
         SET fingerprint = $2, last_alerted_at = NOW(), last_checked_at = NOW(), updated_at = NOW()
         WHERE staff_alert_state.fingerprint IS DISTINCT FROM $2
            OR staff_alert_state.last_alerted_at IS NULL
            OR staff_alert_state.last_alerted_at < NOW() - INTERVAL '${REREMIND_AFTER}'`,
      [key, fingerprint],
    ).then((r) => (r.rowCount ?? 0) > 0),
  );
}

/**
 * Record that a condition was evaluated and found CLEAR.
 *
 * Nulls the fingerprint and the alert timestamp, which re-arms the alert: the
 * next occurrence notifies immediately instead of being swallowed by a
 * re-reminder window left over from the previous incident. That is the exact
 * defect M1 found in the low-balance alert, which went silent for 24 hours
 * after a top-up because nothing cleared its flag.
 */
export async function clearStaffAlert(key: string): Promise<void> {
  await withAdminDb((db) =>
    db.query(
      `INSERT INTO staff_alert_state (alert_key, fingerprint, last_alerted_at, last_checked_at, updated_at)
       VALUES ($1, NULL, NULL, NOW(), NOW())
       ON CONFLICT (alert_key) DO UPDATE
         SET fingerprint = NULL, last_alerted_at = NULL, last_checked_at = NOW(), updated_at = NOW()`,
      [key],
    ),
  ).catch((err) => {
    logger.warn('[staff-alerts] failed to clear alert state', {
      key, err: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Email staff about a condition, at most once per change and once per
 * re-reminder window.
 *
 * Best-effort by construction: failing to warn must never fail the job that
 * noticed. Returns whether an email was actually queued, so a caller can say
 * so in its run record — a job that reports "alerted" when it was rate-limited
 * would be lying in exactly the way this module exists to prevent.
 */
export async function raiseStaffAlert(alert: StaffAlert): Promise<boolean> {
  const to = process.env.EMAIL_ADMIN;
  if (!to) {
    logger.error('[staff-alerts] EMAIL_ADMIN is unset — alert has no recipient', {
      key: alert.key, subject: alert.subject,
    });
    return false;
  }

  let claimed = false;
  try {
    claimed = await claim(alert.key, fingerprintOf(alert.details));
  } catch (err) {
    // A broken bookkeeping table must not silence a real alert, so this fails
    // OPEN — the opposite of the kill switch's fail-closed rule, because the
    // failure modes are opposite: there, a bad lookup must not halt the
    // platform; here, a bad lookup must not hide a problem.
    logger.warn('[staff-alerts] claim failed — alerting anyway', {
      key: alert.key, err: err instanceof Error ? err.message : String(err),
    });
    claimed = true;
  }
  if (!claimed) return false;

  await queueEmail({
    to,
    templateKey: 'staff_operational_alert',
    vars: {
      subject: alert.subject,
      body:    alert.body,
      details: JSON.stringify(alert.details, null, 2),
      window:  REREMIND_AFTER,
    },
    referenceType: 'staff_alert',
    priority:      'high',
  }).catch((err) => {
    logger.error('[staff-alerts] failed to queue alert email', {
      key: alert.key, err: err instanceof Error ? err.message : String(err),
    });
  });

  return true;
}
