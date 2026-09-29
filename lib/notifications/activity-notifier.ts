/**
 * emitActivity() — the single entry point for platform activity.
 *
 *   USER ACTION → business logic (commits) → emitActivity()
 *      → platform_activity_logs (audit)
 *      → routing (registry + preferences) → aggregate? digest : deliveries
 *      → inline send (HIGH/CRITICAL) + job-queue backstop with retries
 *
 * Contract:
 *  - Call it AFTER the business operation has succeeded/committed.
 *  - It NEVER throws. A failed alert must not fail or roll back the business
 *    transaction; failures are logged and (for HIGH/CRITICAL) fall back to a
 *    direct, unpersisted send so an outage of our own database still alerts.
 *  - Idempotent on `dedupKey`.
 */
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { getEventDefinition } from './activity-events';
import { getAdminRecipients, highValueThreshold } from './config';
import {
  createDeliveries,
  deliverNotification,
  enqueueDeliveryJob,
  formatRef,
  rowToEvent,
  type ActivityRow,
} from './notification-queue';
import { renderEmail, renderSms } from './notification-templates';
import { resolveRouting } from './preferences';
import { sanitizeMetadata } from './sanitize';
import { sendAdminEmail } from './email';
import { sendAdminSms } from './sms';
import {
  SEVERITY_RANK,
  type EmitActivityInput,
  type EmitResult,
  type NotificationSeverity,
} from './notification-types';

const INLINE_TIMEOUT_MS = 6_000;

const maxSeverity = (a: NotificationSeverity, b: NotificationSeverity) =>
  SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<undefined>((r) => {
    timer = setTimeout(() => r(undefined), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** Fill in group / actor names from ids so call sites only need to pass ids. Never throws. */
async function enrich(input: EmitActivityInput): Promise<EmitActivityInput> {
  const out = { ...input };
  try {
    await withAdminDb(async (db) => {
      if (out.group?.id && !out.group.name) {
        const { rows } = await db.query<{ name: string }>('SELECT name FROM groups WHERE id = $1', [out.group.id]);
        if (rows[0]) out.group = { id: out.group.id, name: rows[0].name };
      }
      if (out.actor?.userId && !out.actor.name) {
        const { rows } = await db.query<{
          first_name: string;
          last_name: string;
          email: string | null;
          phone: string | null;
        }>('SELECT first_name, last_name, email, phone FROM members WHERE id = $1', [out.actor.userId]);
        if (rows[0]) {
          out.actor = {
            ...out.actor,
            name: `${rows[0].first_name} ${rows[0].last_name}`.trim(),
            email: out.actor.email ?? rows[0].email ?? undefined,
            phone: out.actor.phone ?? rows[0].phone ?? undefined,
          };
        }
      }
    });
  } catch {
    /* enrichment is cosmetic */
  }
  return out;
}

export async function emitActivity(rawInput: EmitActivityInput): Promise<EmitResult> {
  const input = await enrich(rawInput);
  const none: EmitResult = { recorded: false, duplicate: false, queued: 0 };
  let severity: NotificationSeverity = 'WARNING';
  try {
    const def = getEventDefinition(input.type);
    let routing = await resolveRouting(input.type);
    severity = input.severity ?? def.severity;

    let aggregate = routing.aggregate;
    const amount = input.transaction?.amount;
    // Flood protection must not hide an outsized payment: individual SMS + email alert.
    if (aggregate && amount != null && amount >= highValueThreshold()) {
      aggregate = false;
      severity = maxSeverity(severity, 'HIGH');
      routing = { ...routing, sms: true, email: true };
    }
    const notify = input.notify !== false && (routing.sms || routing.email);
    const metadata = sanitizeMetadata({
      ...input.metadata,
      ...(input.adminPath ? { adminPath: input.adminPath } : {}),
    });
    const occurredAt = input.occurredAt ? new Date(input.occurredAt).toISOString() : new Date().toISOString();

    const { activity, deliveryIds } = await withAdminDb(async (db) => {
      const { rows } = await db.query<ActivityRow>(
        `INSERT INTO platform_activity_logs
           (event_type, severity, title, description, actor_user_id, actor, organization_id, organization_name,
            group_id, group_name, transaction_id, reference, amount, currency, status, metadata,
            ip_address, user_agent, dedup_key, notify, aggregate, occurred_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19,$20,$21,$22)
         ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
         RETURNING id, seq, event_type, severity, title, description, actor_user_id, actor, organization_id,
                   organization_name, group_id, group_name, transaction_id, reference, amount, currency,
                   status, metadata, occurred_at, created_at`,
        [
          input.type,
          severity,
          def.title,
          input.description ?? null,
          input.actor?.userId ?? null,
          JSON.stringify(sanitizeMetadata(input.actor as Record<string, unknown> | undefined)),
          input.organization?.id ?? null,
          input.organization?.name ?? null,
          input.group?.id ?? null,
          input.group?.name ?? null,
          input.transaction?.id ?? null,
          input.transaction?.reference ?? null,
          amount != null ? amount.toFixed(2) : null,
          input.transaction?.currency ?? (amount != null ? 'KES' : null),
          input.transaction?.status ?? null,
          JSON.stringify(metadata),
          input.ipAddress ?? null,
          input.userAgent ? String(input.userAgent).slice(0, 300) : null,
          input.dedupKey ?? null,
          notify,
          aggregate && notify,
          occurredAt,
        ],
      );
      const row = rows[0];
      if (!row) return { activity: null, deliveryIds: [] as string[] };
      const ids = notify && !aggregate ? await createDeliveries(db, row.id, routing) : [];
      return { activity: row, deliveryIds: ids };
    });

    if (!activity) return { ...none, duplicate: true };

    for (const id of deliveryIds) await enqueueDeliveryJob(id, severity);
    if (deliveryIds.length) {
      const inline = Promise.allSettled(deliveryIds.map((id) => deliverNotification(id)));
      // HIGH/CRITICAL: wait briefly so the alert is effectively immediate.
      // Others: fire and forget — the queued job is the guaranteed path.
      if (SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH) await withTimeout(inline, INLINE_TIMEOUT_MS);
      else void inline;
    }

    return {
      recorded: true,
      duplicate: false,
      activityId: activity.id,
      activityRef: formatRef('ACT', activity.created_at, activity.seq),
      queued: deliveryIds.length,
    };
  } catch (err) {
    logger.warn('[notifications] emitActivity failed', {
      type: input.type,
      err: err instanceof Error ? err.message : String(err),
    });
    if (SEVERITY_RANK[severity] >= SEVERITY_RANK.HIGH) await directFallback(input, severity);
    return none;
  }
}

/**
 * Last resort when our own database is unreachable: send HIGH/CRITICAL alerts
 * straight to the providers without persisting anything, so an outage that
 * takes the audit table down is still heard. Best effort, never throws.
 */
async function directFallback(input: EmitActivityInput, severity: NotificationSeverity): Promise<void> {
  try {
    const def = getEventDefinition(input.type);
    const event = rowToEvent({
      id: 'unpersisted',
      seq: '0',
      event_type: input.type,
      severity,
      title: def.title,
      description: input.description ?? null,
      actor_user_id: null,
      actor: input.actor ?? null,
      organization_id: input.organization?.id ?? null,
      organization_name: input.organization?.name ?? null,
      group_id: input.group?.id ?? null,
      group_name: input.group?.name ?? null,
      transaction_id: input.transaction?.id ?? null,
      reference: input.transaction?.reference ?? null,
      amount: input.transaction?.amount != null ? String(input.transaction.amount) : null,
      currency: input.transaction?.currency ?? null,
      status: input.transaction?.status ?? null,
      metadata: sanitizeMetadata(input.metadata),
      occurred_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    });
    event.activityRef = 'UNPERSISTED';
    const { phones, emails } = getAdminRecipients();
    await Promise.allSettled([
      ...(def.sms ? phones.map((p) => sendAdminSms(p, renderSms(event))) : []),
      ...(def.email ? emails.map((e) => sendAdminEmail(e, renderEmail(event), `fallback:${input.type}`)) : []),
    ]);
  } catch {
    /* nothing left to try */
  }
}

/**
 * Transactional-outbox variant for code that is already inside a database
 * transaction (payment callbacks). The activity row commits or rolls back
 * atomically with the business write, so a rolled-back payment never leaves a
 * phantom alert, and the caller does no network I/O. Delivery is picked up by
 * sweepUndeliveredActivities() on the 5-minute job tick (aggregate events go
 * to the digest instead). Never throws.
 */
export async function recordActivityInTx(db: PoolClient, input: EmitActivityInput): Promise<void> {
  try {
    const def = getEventDefinition(input.type);
    let routing = await resolveRouting(input.type);
    const amount = input.transaction?.amount;
    let aggregate = routing.aggregate;
    let severity = input.severity ?? def.severity;
    if (aggregate && amount != null && amount >= highValueThreshold()) {
      aggregate = false;
      severity = maxSeverity(severity, 'HIGH');
      routing = { ...routing, sms: true, email: true };
    }
    const notify = input.notify !== false && (routing.sms || routing.email);
    const isUuid = (v?: string | null) =>
      !!v && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
    // A SAVEPOINT keeps a failed alert insert from aborting the caller's payment transaction.
    await db.query('SAVEPOINT platform_activity');
    await db.query(
      `INSERT INTO platform_activity_logs
         (event_type, severity, title, description, actor_user_id, actor, group_id, group_name,
          transaction_id, reference, amount, currency, status, metadata, dedup_key, notify, aggregate, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,NOW())
       ON CONFLICT (dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING`,
      [
        input.type,
        severity,
        def.title,
        input.description ?? null,
        input.actor?.userId ?? null,
        JSON.stringify(sanitizeMetadata(input.actor as Record<string, unknown> | undefined)),
        isUuid(input.group?.id) ? input.group?.id : null,
        input.group?.name ?? null,
        input.transaction?.id ?? null,
        input.transaction?.reference ?? null,
        amount != null ? amount.toFixed(2) : null,
        input.transaction?.currency ?? (amount != null ? 'KES' : null),
        input.transaction?.status ?? null,
        JSON.stringify(sanitizeMetadata(input.metadata)),
        input.dedupKey ?? null,
        notify,
        aggregate && notify,
      ],
    );
    await db.query('RELEASE SAVEPOINT platform_activity');
  } catch (err) {
    logger.warn('[notifications] recordActivityInTx failed', { type: input.type, err: String(err) });
    await db.query('ROLLBACK TO SAVEPOINT platform_activity').catch(() => {});
  }
}

/**
 * Create deliveries for activities that were recorded (in a transaction, or
 * before a crash) but never got any. Runs on the 5-minute job tick.
 */
export async function sweepUndeliveredActivities(limit = 50): Promise<number> {
  const rows = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ id: string; event_type: string; severity: NotificationSeverity }>(
      `SELECT a.id, a.event_type, a.severity
       FROM   platform_activity_logs a
       WHERE  a.notify AND NOT a.aggregate
         AND  a.created_at < NOW() - INTERVAL '30 seconds'
         AND  a.created_at > NOW() - INTERVAL '2 days'
         AND  NOT EXISTS (SELECT 1 FROM notification_deliveries d WHERE d.activity_id = a.id)
       ORDER  BY a.created_at
       LIMIT  $1`,
      [limit],
    );
    return rows;
  });
  let n = 0;
  for (const r of rows) {
    const base = await resolveRouting(r.event_type);
    // A non-aggregate row of an aggregate-by-default event was escalated (high value): SMS + email.
    const routing = base.aggregate ? { ...base, sms: true, email: true } : base;
    const ids = await withAdminDb((db) => createDeliveries(db, r.id, routing));
    for (const id of ids) await enqueueDeliveryJob(id, r.severity);
    n += ids.length;
  }
  return n;
}
