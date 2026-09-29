/**
 * Delivery queue: one notification_deliveries row per (event, channel,
 * recipient), unique on idempotency_key so an event can never notify twice.
 *
 * Delivery is logically separate from the business transaction: rows are
 * created after the activity is recorded, sent inline (best effort, HIGH and
 * CRITICAL only) and always backstopped by a job_queue job that retries with
 * exponential backoff up to MAX_DELIVERY_ATTEMPTS, then persists FAILED.
 */
import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { enqueueJob } from '@/lib/jobs';
import { getAdminRecipients, MAX_DELIVERY_ATTEMPTS } from './config';
import { renderEmail, renderSms } from './notification-templates';
import { sendAdminSms } from './sms';
import { sendAdminEmail } from './email';
import type { NotificationChannel, NotificationSeverity, PlatformActivityEvent } from './notification-types';
import { ActivityEventType } from './activity-events';

export interface ActivityRow {
  id: string;
  seq: string;
  event_type: string;
  severity: NotificationSeverity;
  title: string;
  description: string | null;
  actor_user_id: string | null;
  actor: PlatformActivityEvent['actor'] | null;
  organization_id: string | null;
  organization_name: string | null;
  group_id: string | null;
  group_name: string | null;
  transaction_id: string | null;
  reference: string | null;
  amount: string | null;
  currency: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  occurred_at: string;
  created_at: string;
}

const eatDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(iso)).replace(/-/g, '');

/** ACT-20260929-000123 / SMS-… / EMAIL-… */
export function formatRef(prefix: 'ACT' | 'SMS' | 'EMAIL', createdAt: string | Date, seq: string | number): string {
  const iso = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();
  return `${prefix}-${eatDate(iso)}-${String(seq).padStart(6, '0')}`;
}

export function rowToEvent(r: ActivityRow): PlatformActivityEvent {
  const amount = r.amount != null ? Number(r.amount) : undefined;
  return {
    id: r.id,
    type: r.event_type,
    severity: r.severity,
    title: r.title,
    description: r.description ?? undefined,
    actor: r.actor && Object.keys(r.actor).length ? r.actor : undefined,
    organization: r.organization_id ? { id: r.organization_id, name: r.organization_name ?? '' } : undefined,
    group: r.group_id ? { id: r.group_id, name: r.group_name ?? '' } : undefined,
    transaction:
      r.transaction_id || r.reference || amount != null || r.status
        ? {
            id: r.transaction_id ?? undefined,
            reference: r.reference ?? undefined,
            amount,
            currency: r.currency ?? undefined,
            status: r.status ?? undefined,
            type: typeof r.metadata?.transactionType === 'string' ? (r.metadata.transactionType as string) : undefined,
          }
        : undefined,
    metadata: r.metadata ?? {},
    occurredAt: r.occurred_at,
    notificationRequired: true,
    activityRef: formatRef('ACT', r.created_at, r.seq),
  };
}

const JOB_PRIORITY: Record<NotificationSeverity, number> = { INFO: 3, WARNING: 5, HIGH: 8, CRITICAL: 10 };

/** Create pending delivery rows for the enabled channels. Returns the new delivery ids. */
export async function createDeliveries(
  db: PoolClient,
  activityId: string,
  channels: { sms: boolean; email: boolean },
): Promise<string[]> {
  const { phones, emails } = getAdminRecipients();
  const targets: { channel: NotificationChannel; recipient: string }[] = [
    ...(channels.sms ? phones.map((recipient) => ({ channel: 'sms' as const, recipient })) : []),
    ...(channels.email ? emails.map((recipient) => ({ channel: 'email' as const, recipient })) : []),
  ];
  if (targets.length === 0) {
    logger.warn('[notifications] no admin recipients configured (KITABU_ADMIN_ALERT_PHONE / _EMAIL)', { activityId });
  }
  const ids: string[] = [];
  for (const t of targets) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO notification_deliveries (activity_id, channel, recipient, status, idempotency_key)
       VALUES ($1,$2,$3,'PENDING',$4)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [activityId, t.channel, t.recipient, `${activityId}:${t.channel}:${t.recipient}`],
    );
    if (rows[0]) ids.push(rows[0].id);
  }
  return ids;
}

/** Backstop job (retries with backoff). Safe to call more than once: the job dedups. */
export async function enqueueDeliveryJob(deliveryId: string, severity: NotificationSeverity): Promise<void> {
  try {
    await enqueueJob(
      'admin_alert_deliver',
      { deliveryId },
      { priority: JOB_PRIORITY[severity], max_attempts: MAX_DELIVERY_ATTEMPTS, dedup_key: `admin_alert:${deliveryId}` },
    );
  } catch (err) {
    logger.warn('[notifications] could not enqueue delivery job', { deliveryId, err: String(err) });
  }
}

interface DeliveryRow {
  id: string;
  seq: string;
  activity_id: string;
  channel: NotificationChannel;
  recipient: string;
  attempt_count: number;
  created_at: string;
}

export type DeliverOutcome = 'sent' | 'skipped' | 'failed_permanent' | 'failed_retry';

/**
 * Attempt one delivery. Claims the row first so an inline send and the backstop
 * job can never both send. A row stuck in QUEUED (function frozen mid-send) is
 * reclaimable after 3 minutes.
 *
 * Throws on a retryable failure so the job queue applies its backoff; returns
 * 'failed_permanent' once attempts are exhausted (the row is FAILED and an
 * admin-visible event is recorded).
 */
export async function deliverNotification(
  deliveryId: string,
  opts: { throwOnRetry?: boolean } = {},
): Promise<DeliverOutcome> {
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<DeliveryRow>(
      `UPDATE notification_deliveries
       SET    status = 'QUEUED', attempt_count = attempt_count + 1, updated_at = NOW()
       WHERE  id = $1
         AND (status IN ('PENDING','RETRYING')
              OR (status = 'QUEUED' AND updated_at < NOW() - INTERVAL '3 minutes'))
       RETURNING id, seq, activity_id, channel, recipient, attempt_count, created_at`,
      [deliveryId],
    );
    if (!rows[0]) return null;
    const { rows: act } = await db.query<ActivityRow>(
      `SELECT id, seq, event_type, severity, title, description, actor_user_id, actor, organization_id,
              organization_name, group_id, group_name, transaction_id, reference, amount, currency, status,
              metadata, occurred_at, created_at
       FROM platform_activity_logs WHERE id = $1`,
      [rows[0].activity_id],
    );
    return act[0] ? { delivery: rows[0], activity: act[0] } : null;
  });
  if (!claimed) return 'skipped';

  const { delivery, activity } = claimed;
  const event = rowToEvent(activity);
  const adminPath =
    typeof activity.metadata?.adminPath === 'string' ? (activity.metadata.adminPath as string) : undefined;
  const ref = formatRef(delivery.channel === 'sms' ? 'SMS' : 'EMAIL', delivery.created_at, delivery.seq);

  const result =
    delivery.channel === 'sms'
      ? await sendAdminSms(delivery.recipient, renderSms(event))
      : await sendAdminEmail(delivery.recipient, renderEmail(event, adminPath), ref);

  if (result.ok) {
    await withAdminDb((db) =>
      db.query(
        `UPDATE notification_deliveries
         SET status = 'SENT', provider = $2, provider_message_id = $3, error_message = NULL,
             sent_at = NOW(), updated_at = NOW()
         WHERE id = $1`,
        [deliveryId, result.provider, result.messageId ?? null],
      ),
    );
    logger.info('[notifications] delivered', { activity: event.activityRef, delivery: ref, channel: delivery.channel });
    return 'sent';
  }

  const exhausted = delivery.attempt_count >= MAX_DELIVERY_ATTEMPTS;
  await withAdminDb((db) =>
    db.query(
      `UPDATE notification_deliveries
       SET status = $2, provider = $3, error_message = $4, updated_at = NOW()
       WHERE id = $1`,
      [deliveryId, exhausted ? 'FAILED' : 'RETRYING', result.provider, (result.error ?? 'unknown error').slice(0, 500)],
    ),
  );
  logger.warn('[notifications] delivery failed', {
    activity: event.activityRef,
    delivery: ref,
    channel: delivery.channel,
    attempt: delivery.attempt_count,
    exhausted,
    error: result.error,
  });

  if (exhausted) {
    if (event.type !== ActivityEventType.NOTIFICATION_DELIVERY_FAILED) {
      // Lazy import: notifier imports this module.
      const { emitActivity } = await import('./activity-notifier');
      await emitActivity({
        type: ActivityEventType.NOTIFICATION_DELIVERY_FAILED,
        dedupKey: `delivery-failed:${deliveryId}`,
        description: `An administrator ${delivery.channel} for "${event.title}" could not be delivered after ${MAX_DELIVERY_ATTEMPTS} attempts.`,
        metadata: { channel: delivery.channel, originalActivity: event.activityRef, error: result.error },
      });
    }
    return 'failed_permanent';
  }
  if (opts.throwOnRetry) throw new Error(`${delivery.channel} delivery failed: ${result.error ?? 'unknown'}`);
  return 'failed_retry';
}
