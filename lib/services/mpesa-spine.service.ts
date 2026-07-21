/**
 * Payment-spine primitives (payment architecture §3.4, §7, §12), shared by
 * every M-Pesa flow (STK, C2B, B2C, unrouted resolution). Every state change
 * on a `payments` row appends a `payment_events` row; money-adjacent side
 * effects are announced via the transactional outbox (written in the SAME
 * transaction, so an event exists iff the change committed — ADR-17).
 *
 * Split out of mpesa.service.ts (OPTIMIZATION_CLEANUP_AUDIT.md High #9).
 */

import type { PoolClient } from 'pg';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { formatMembershipNo } from '@/lib/utils/membership-no';

// Sandbox env stamps `is_test=true` on every M-Pesa row + downstream journal
// entry so a single DELETE WHERE is_test wipes test data pre-production.
export const IS_SANDBOX = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';

export async function logPaymentEvent(
  db:        PoolClient,
  paymentId: string,
  event:     'received' | 'validated' | 'allocated' | 'journal_posted' | 'unrouted' |
             'reallocated' | 'reversed' | 'refunded' | 'charged_back' | 'replayed',
  detail?:   Record<string, unknown>,
  actor?:    string | null,
): Promise<void> {
  await db.query(
    `INSERT INTO payment_events (payment_id, event, actor, detail)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [paymentId, event, actor ?? null, JSON.stringify(detail ?? {})],
  );
}

export async function emitOutbox(
  db:          PoolClient,
  eventType:   string,
  aggregateId: string,
  payload:     Record<string, unknown>,
): Promise<void> {
  await db.query(
    `INSERT INTO event_outbox (event_type, aggregate_id, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [eventType, aggregateId, JSON.stringify(payload)],
  );
}

/** Spine payment id for a receipt (null when no payments row exists). */
export async function spinePaymentId(db: PoolClient, receipt: string): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM payments WHERE mpesa_receipt_number = $1 LIMIT 1`,
    [receipt],
  );
  return rows[0]?.id ?? null;
}

/**
 * Transition the spine to 'allocated' after a successful domain allocation.
 * Idempotent: only rows still in received/unrouted transition.
 */
export async function markSpineAllocated(
  db:      PoolClient,
  receipt: string,
  opts?:   { isThirdParty?: boolean; actor?: string | null; detail?: Record<string, unknown> },
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE payments
     SET    allocation_status = 'allocated',
            is_third_party    = is_third_party OR $2
     WHERE  mpesa_receipt_number = $1
       AND  allocation_status IN ('received','unrouted')
     RETURNING id`,
    [receipt, opts?.isThirdParty ?? false],
  );
  const paymentId = rows[0]?.id;
  if (!paymentId) return;
  await logPaymentEvent(db, paymentId, 'allocated', opts?.detail, opts?.actor);
  await emitOutbox(db, 'payment.allocated', paymentId, {
    receipt, ...(opts?.detail ?? {}),
  });
}

/** Transition the spine to 'unrouted' when auto-allocation could not bind. */
export async function markSpineUnrouted(
  db:      PoolClient,
  receipt: string,
  reason:  string,
): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE payments
     SET    allocation_status = 'unrouted'
     WHERE  mpesa_receipt_number = $1 AND allocation_status = 'received'
     RETURNING id`,
    [receipt],
  );
  const paymentId = rows[0]?.id;
  if (!paymentId) return; // surrogate receipts (reconciliation) have no spine row
  await logPaymentEvent(db, paymentId, 'unrouted', { reason });
  await emitOutbox(db, 'payment.unrouted', paymentId, { receipt, reason });
}

/**
 * Emit the member-facing payment receipt event (§8 / audit M-2) for an
 * ALLOCATED payment — the SMS names the group, the Membership Number, the
 * product, and the updated balance, so a multi-group member always knows
 * which membership the money landed on. Product-specific enrichment:
 *
 *   savings        → contributions row + completed-contributions balance
 *   loan repayment → loan_repayments row + the loan's outstanding balance
 *   welfare        → welfare_pool_contributions row + welfare total
 *
 * Non-membership payments (invoices, top-ups) emit with the basic vars and
 * the template engine strips the unresolved placeholders. Must be called
 * AFTER the money transaction committed (emitBusinessEvent does its own DB
 * work and may send inline). Best-effort by design — never throws.
 */
export async function emitPaymentReceiptEvent(
  paymentId: string,
  opts?: { requireAllocated?: boolean },
): Promise<void> {
  try {
    const { emitBusinessEvent } = await import('@/lib/sms/trigger-engine');
    const { SMS_EVENTS }        = await import('@/lib/sms/events');

    const data = await withAdminDb(async (db) => {
      const { rows: [payment] } = await db.query<{
        group_id: string; amount: string; mpesa_phone: string | null;
        mpesa_receipt_number: string | null; allocation_status: string;
      }>(
        `SELECT group_id, amount, mpesa_phone, mpesa_receipt_number, allocation_status
         FROM   payments WHERE id = $1`,
        [paymentId],
      );
      if (!payment) return null;
      // C2B callers only confirm money that actually landed on a membership;
      // STK callers keep the historical always-confirm behaviour (invoice and
      // top-up payments never reach 'allocated' but still deserve a receipt).
      if (opts?.requireAllocated && payment.allocation_status !== 'allocated') return null;

      const { rows: [alloc] } = await db.query<{
        product: string; group_name: string; membership_no: string | null; balance: string;
      }>(
        `SELECT 'savings' AS product, g.name AS group_name, gm.membership_no,
                COALESCE((SELECT SUM(c2.amount) FROM contributions c2
                          WHERE c2.group_membership_id = gm.id AND c2.status = 'completed'), 0)::text AS balance
         FROM   contributions c
         JOIN   group_members gm ON gm.id = c.group_membership_id
         JOIN   groups g         ON g.id  = c.group_id
         WHERE  c.payment_id = $1
         UNION ALL
         SELECT 'loan repayment', g.name, gm.membership_no,
                l.outstanding_balance::text
         FROM   loan_repayments lr
         JOIN   loans l          ON l.id  = lr.loan_id
         JOIN   group_members gm ON gm.id = lr.group_membership_id
         JOIN   groups g         ON g.id  = lr.group_id
         WHERE  lr.payment_id = $1
         UNION ALL
         SELECT 'welfare', g.name, gm.membership_no,
                COALESCE((SELECT SUM(w2.amount) FROM welfare_pool_contributions w2
                          WHERE w2.group_membership_id = gm.id), 0)::text
         FROM   welfare_pool_contributions w
         JOIN   group_members gm ON gm.id = w.group_membership_id
         JOIN   groups g         ON g.id  = w.group_id
         WHERE  w.payment_id = $1
         LIMIT  1`,
        [paymentId],
      );
      return { payment, alloc: alloc ?? null };
    });
    if (!data) return;

    await emitBusinessEvent({
      eventType: SMS_EVENTS.PAYMENT_RECEIVED,
      eventId:   paymentId,
      groupId:   data.payment.group_id,
      payload: {
        amount:  parseFloat(data.payment.amount),
        receipt: data.payment.mpesa_receipt_number ?? 'N/A',
        phone:   data.payment.mpesa_phone,
        ...(data.alloc ? {
          group_name:    data.alloc.group_name,
          membership_no: data.alloc.membership_no ? formatMembershipNo(data.alloc.membership_no) : undefined,
          product:       data.alloc.product,
          balance:       Number(data.alloc.balance).toLocaleString(),
        } : {}),
      },
    });
  } catch (err) {
    logger.warn('[mpesa] receipt event emit skipped', { paymentId, err: String(err) });
  }
}
