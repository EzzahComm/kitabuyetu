/**
 * Aggregated admin notifications (flood protection).
 *
 * Routine high-volume events (contributions, PayBill payments, STK results…)
 * are recorded individually but NOT alerted individually. Every
 * KITABU_ADMIN_DIGEST_MINUTES (default 60) - or sooner if a burst piles up -
 * one ACTIVITY_DIGEST summary is emitted covering everything since the last.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { ActivityEventType, getEventDefinition } from './activity-events';
import { digestWindowMinutes } from './config';
import { emitActivity, sweepUndeliveredActivities } from './activity-notifier';
import { formatMoney } from './notification-templates';

const BURST_THRESHOLD = 500;
const MAX_ROWS = 5000;

interface Claimed {
  id: string;
  event_type: string;
  amount: string | null;
  organization_id: string | null;
  status: string | null;
  created_at: string;
}

export async function runAdminDigest(): Promise<{ sent: boolean; events: number }> {
  // Outbox sweep first: alerts recorded inside payment transactions get their deliveries here.
  await sweepUndeliveredActivities().catch((err) =>
    logger.warn('[notifications] outbox sweep failed', { err: String(err) }),
  );

  const windowMin = digestWindowMinutes();

  const due = await withAdminDb(async (db) => {
    const { rows } = await db.query<{ pending: string; oldest: string | null; last: string | null }>(
      `SELECT (SELECT COUNT(*) FROM platform_activity_logs
                WHERE aggregate AND notify AND digest_sent_at IS NULL)::text AS pending,
              (SELECT MIN(created_at) FROM platform_activity_logs
                WHERE aggregate AND notify AND digest_sent_at IS NULL) AS oldest,
              (SELECT MAX(created_at) FROM platform_activity_logs
                WHERE event_type = $1) AS last`,
      [ActivityEventType.ACTIVITY_DIGEST],
    );
    return rows[0];
  });
  const pending = Number(due?.pending ?? 0);
  if (pending === 0) return { sent: false, events: 0 };
  const lastMs = due?.last ? new Date(due.last).getTime() : 0;
  const windowElapsed = Date.now() - lastMs >= windowMin * 60_000;
  if (!windowElapsed && pending < BURST_THRESHOLD) return { sent: false, events: 0 };

  // Claim atomically so concurrent runs cannot double-count.
  const claimed = await withAdminDb(async (db) => {
    const { rows } = await db.query<Claimed>(
      `UPDATE platform_activity_logs
       SET    digest_sent_at = NOW()
       WHERE  id IN (
         SELECT id FROM platform_activity_logs
         WHERE  aggregate AND notify AND digest_sent_at IS NULL
         ORDER  BY created_at
         LIMIT  ${MAX_ROWS}
         FOR UPDATE SKIP LOCKED
       )
       RETURNING id, event_type, amount, organization_id, status, created_at`,
    );
    return rows;
  });
  if (claimed.length === 0) return { sent: false, events: 0 };

  const byType = new Map<string, { n: number; total: number; failed: number }>();
  const orgs = new Set<string>();
  let total = 0;
  let failed = 0;
  for (const r of claimed) {
    const g = byType.get(r.event_type) ?? { n: 0, total: 0, failed: 0 };
    g.n++;
    const amt = r.amount ? Number(r.amount) : 0;
    g.total += amt;
    total += amt;
    const isFail = /FAIL|REVERSED/.test(r.event_type) || /^(failed|FAILED)$/.test(r.status ?? '');
    if (isFail) {
      g.failed++;
      failed++;
    }
    byType.set(r.event_type, g);
    if (r.organization_id) orgs.add(r.organization_id);
  }

  const since = claimed.reduce((m, r) => (r.created_at < m ? r.created_at : m), claimed[0].created_at);
  const metadata: Record<string, unknown> = {
    'Events summarised': claimed.length,
    'Total value': formatMoney(total) ?? 'n/a',
    'Organizations affected': orgs.size,
    Failed: failed,
    Since: new Date(since).toISOString(),
  };
  [...byType.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, 25)
    .forEach(([type, g]) => {
      metadata[getEventDefinition(type).title] =
        `${g.n}${g.total ? ` (${formatMoney(g.total)})` : ''}${g.failed ? `, ${g.failed} failed` : ''}`;
    });

  const res = await emitActivity({
    type: ActivityEventType.ACTIVITY_DIGEST,
    description: `${claimed.length} routine events since ${new Date(since).toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    dedupKey: `digest:${claimed[0].id}`,
    metadata,
    transaction: total ? { amount: total, status: `${failed} failed` } : undefined,
  });

  if (!res.recorded) {
    // Could not record the summary - put the rows back so the next run retries.
    logger.error('[notifications] digest emit failed; releasing claimed rows', { events: claimed.length });
    await withAdminDb((db) =>
      db.query('UPDATE platform_activity_logs SET digest_sent_at = NULL WHERE id = ANY($1::uuid[])', [
        claimed.map((c) => c.id),
      ]),
    );
    return { sent: false, events: 0 };
  }
  return { sent: true, events: claimed.length };
}
