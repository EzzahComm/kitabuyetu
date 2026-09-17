import { withAdminDb } from "@/lib/db";
import { sendTemplatedEmail } from "./email.service";
import { logger } from "@/lib/logger";
import { tickBudgetExhausted } from "@/lib/jobs/deadline";

// Process all due email_schedules rows
export async function processDueSchedules(): Promise<{
  processed: number;
  failed: number;
}> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT * FROM email_schedules
       WHERE is_active = true AND next_run_at <= NOW()
       ORDER BY next_run_at ASC
       LIMIT 100`,
      [],
    ),
  );

  let processed = 0;
  let failed = 0;

  for (const sched of rows) {
    try {
      const vars =
        (sched.variables as Record<string, string | number | boolean>) ?? {};

      await sendTemplatedEmail({
        templateKey: sched.template_key,
        to: sched.recipient_email,
        vars,
        groupId: sched.group_id,
        referenceId: sched.reference_id,
        referenceType: sched.reference_type,
      });

      if (sched.schedule_type === "once") {
        await withAdminDb(async (db) => {
          await db.query(
            `UPDATE email_schedules SET is_active=false, last_run_at=NOW() WHERE id=$1`,
            [sched.id],
          );
          await db.query(
            `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
             VALUES ($1, NULL, $2, 'email_schedule', $3, $4, $5)`,
            [
              sched.group_id,
              'email_schedule.sent_once',
              sched.id,
              JSON.stringify({ is_active: true, schedule_type: 'once' }),
              JSON.stringify({ is_active: false, status: 'completed' }),
            ],
          );
        });
      } else {
        const nextRun = computeNextRun(
          sched.schedule_type,
          new Date(sched.next_run_at),
        );
        await withAdminDb(async (db) => {
          await db.query(
            `UPDATE email_schedules SET last_run_at=NOW(), next_run_at=$1 WHERE id=$2`,
            [nextRun.toISOString(), sched.id],
          );
          await db.query(
            `INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, old_values, new_values)
             VALUES ($1, NULL, $2, 'email_schedule', $3, $4, $5)`,
            [
              sched.group_id,
              'email_schedule.sent_recurring',
              sched.id,
              JSON.stringify({ next_run_at: sched.next_run_at }),
              JSON.stringify({ next_run_at: nextRun.toISOString() }),
            ],
          );
        });
      }

      processed++;
    } catch (err) {
      logger.error("[scheduler] Failed to send scheduled email", sched.id, err);
      failed++;
    }
  }

  return { processed, failed };
}

function computeNextRun(scheduleType: string, current: Date): Date {
  const d = new Date(current);
  switch (scheduleType) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;
    case "weekly":
      d.setDate(d.getDate() + 7);
      break;
    case "monthly":
      d.setMonth(d.getMonth() + 1);
      break;
    default:
      d.setDate(d.getDate() + 1);
      break;
  }
  return d;
}

// Retry failed emails from email_logs (status=failed, older than 5 min, fewer than 3 retries
// per recipient+template+reference in the last 24h — see the guard below).
export async function retryFailedEmails(): Promise<{
  retried: number;
  skipped: number;
}> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT * FROM email_logs
       WHERE status = 'failed'
         AND created_at >= NOW() - INTERVAL '24 hours'
         AND created_at <= NOW() - INTERVAL '5 minutes'
       ORDER BY created_at ASC
       LIMIT 5`,
      [],
    ),
  );

  let retried = 0;
  let skipped = 0;
  for (const log of rows) {
    // Bounds this handler inside the job tick's remaining budget — without
    // it, a run of dead-SMTP-fallback sends can eat the whole 50s tick and
    // abort the round-robin before other job types get a turn.
    if (tickBudgetExhausted(35_000)) break;
    if (!log.template_key) continue;

    // group_verification_link's retry can never be correct: this loop has
    // no way to reconstruct the original vars (name/groupName/groupCode/
    // verifyUrl), so a "retry" always sends with vars={}, which the
    // DEFAULT_TEMPLATES fallback renders as a blank-name, blank-group email
    // with an EMPTY verify link — confirmed live as the mechanism behind a
    // real incident (one recipient received hundreds of broken verification
    // emails). Bounding the retry count doesn't fix this — even one retry
    // sends something unusable — so this template is excluded from retry
    // entirely rather than merely rate-limited (docs/audits/
    // optimization-2026-09).
    if (log.template_key === "group_verification_link") {
      skipped++;
      continue;
    }

    // Retry-count guard. Each attempt (success or failure) INSERTs a new
    // email_logs row rather than updating the original, so without this a
    // poison (recipient, template, reference) triple re-sends forever —
    // confirmed live: one recipient received hundreds of duplicate emails
    // in 24h before this guard existed. IS NOT DISTINCT FROM (not
    // COALESCE(..., '')): reference_id is a uuid column, and an empty
    // string is not a valid uuid literal — Postgres resolves COALESCE's
    // common type at parse time, so `COALESCE(reference_id, '')` fails
    // unconditionally, not just when reference_id happens to be null. This
    // silently crashed the guard (and therefore this whole function) on
    // every invocation since it was added — job_logs showed
    // 'invalid input syntax for type uuid: ""' on every attempt, which
    // also meant genuine transient failures for every OTHER template were
    // never being retried either.
    let guardCount = 0;
    try {
      const { rows: countRows } = await withAdminDb((db) =>
        db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM email_logs
           WHERE "to" = $1 AND template_key = $2
             AND reference_id IS NOT DISTINCT FROM $3
             AND created_at >= NOW() - INTERVAL '24 hours'`,
          [log.to, log.template_key, log.reference_id],
        ),
      );
      guardCount = Number(countRows[0]?.count ?? 0);
    } catch (err) {
      // A guard-query failure must not crash the whole batch the way the
      // COALESCE bug did — skip just this row.
      logger.error("[scheduler] Retry-count guard failed, skipping row", err);
      skipped++;
      continue;
    }
    if (guardCount >= 3) {
      skipped++;
      continue;
    }

    try {
      const result = await sendTemplatedEmail({
        templateKey: log.template_key,
        to: log.to,
        vars: {},
        groupId: log.group_id,
        referenceId: log.reference_id,
        referenceType: log.reference_type,
      });
      if (result.success) {
        retried++;
      } else if (/quota/i.test(result.error ?? "")) {
        // A quota rejection means every remaining send in this batch fails
        // the same way — stop burning tick budget on certain failures.
        logger.warn(
          "[scheduler] Provider quota hit — aborting retry batch",
          result.error,
        );
        break;
      }
    } catch {
      // Give up on this one — it will age out of the 24h window
    }
  }

  return { retried, skipped };
}
