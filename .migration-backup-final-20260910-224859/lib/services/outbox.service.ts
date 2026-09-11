/**
 * Transactional-outbox dispatcher + payment-spine orphan monitor
 * (payment architecture §12 / ADR-17, and §16 observability).
 *
 * Outbox rows are written in the SAME transaction as the money change, so an
 * event exists iff the change committed. This dispatcher drains them with
 * at-least-once semantics (FOR UPDATE SKIP LOCKED; consumers must be
 * idempotent).
 *
 * Consumer note (Phase 1.5): the SMS receipt still runs on its existing
 * direct `emitBusinessEvent` path (idempotent per rule+paymentId), so this
 * dispatcher currently ACKNOWLEDGES rows rather than fanning out — it exists
 * so the queue-depth metric is real and so Phase 2 consumers (notifications,
 * balance caches, webhooks) plug into an already-running pipeline instead of
 * a dead table. Rows that repeatedly fail are parked (dead) with a loud log.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

const BATCH        = 100;
const MAX_ATTEMPTS = 5;

interface OutboxRow {
  id:           string;
  event_type:   string;
  aggregate_id: string;
  payload:      Record<string, unknown>;
  attempts:     number;
}

export async function dispatchOutboxEvents(): Promise<{
  processed: number; failed: number; dead: number;
}> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<OutboxRow>(
      `SELECT id, event_type, aggregate_id, payload, attempts
       FROM   event_outbox
       WHERE  processed_at IS NULL
       ORDER  BY id
       LIMIT  $1
       FOR UPDATE SKIP LOCKED`,
      [BATCH],
    );

    let processed = 0;
    let failed    = 0;
    let dead      = 0;

    for (const row of rows) {
      try {
        await handleOutboxEvent(row);
        await db.query(
          `UPDATE event_outbox SET processed_at = NOW(), attempts = attempts + 1 WHERE id = $1`,
          [row.id],
        );
        processed++;
      } catch (err) {
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Park it: mark processed so the queue drains, but record the death
          // loudly — the §16 alert on this log line is the operator signal.
          await db.query(
            `UPDATE event_outbox SET processed_at = NOW(), attempts = $2 WHERE id = $1`,
            [row.id, attempts],
          );
          logger.error('[outbox] event dead after max attempts', {
            id: row.id, eventType: row.event_type, aggregateId: row.aggregate_id, err: String(err),
          });
          dead++;
        } else {
          await db.query(
            `UPDATE event_outbox SET attempts = $2 WHERE id = $1`,
            [row.id, attempts],
          );
          failed++;
        }
      }
    }

    return { processed, failed, dead };
  });
}

/**
 * Per-type consumer fan-out. Deliberately minimal in Phase 1.5 (see module
 * comment); each Phase 2 consumer adds a case here — always idempotent.
 */
async function handleOutboxEvent(row: OutboxRow): Promise<void> {
  switch (row.event_type) {
    case 'payment.received':
    case 'payment.allocated':
    case 'payment.unrouted':
      // Acknowledged. SMS receipts run on the existing direct trigger-engine
      // path; migrating them here is a Phase 2 task.
      return;
    default:
      // Unknown types are acknowledged too — an outbox must never wedge on a
      // producer/consumer version skew; new consumers deploy before producers.
      logger.warn('[outbox] no consumer for event type', { eventType: row.event_type });
      return;
  }
}

/**
 * Orphan monitor (§16): completed money stuck in allocation_status='received'.
 * The window excludes the last 15 minutes (allocation may be in flight) and
 * anything older than 7 days (pre-spine history never alerts).
 */
export async function findSpineOrphans(): Promise<{
  count: number; samples: { id: string; receipt: string | null; amount: string; ageMinutes: number }[];
}> {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      id: string; mpesa_receipt_number: string | null; amount: string; age_minutes: number;
    }>(
      `SELECT id, mpesa_receipt_number, amount,
              EXTRACT(EPOCH FROM (NOW() - payment_date)) / 60 AS age_minutes
       FROM   payments
       WHERE  status = 'completed'
         AND  allocation_status = 'received'
         AND  payment_date BETWEEN NOW() - INTERVAL '7 days'
                               AND NOW() - INTERVAL '15 minutes'
       ORDER  BY payment_date ASC
       LIMIT  20`,
    );

    const samples = rows.map((r) => ({
      id: r.id, receipt: r.mpesa_receipt_number,
      amount: r.amount, ageMinutes: Math.round(Number(r.age_minutes)),
    }));

    if (samples.length > 0) {
      // §16: this log line is the paging signal — completed money that never
      // reached a ledger is the one thing that must never sit quietly.
      logger.error('[spine] orphaned payments detected (received but never allocated)', {
        count: samples.length, samples: samples.slice(0, 5),
      });
    }

    return { count: samples.length, samples };
  });
}
