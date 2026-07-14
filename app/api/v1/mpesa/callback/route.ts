import { NextRequest, NextResponse, after } from 'next/server';
import {
  handleSTKCallback,
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  type StkCallbackBody,
} from '@/lib/services/mpesa.service';
import { billingService } from '@/lib/services/billing.service';
import { emitBusinessEvent } from '@/lib/sms/trigger-engine';
import { SMS_EVENTS } from '@/lib/sms/events';
import { isSafaricomIp } from '@/lib/services/daraja.service';
import { formatMembershipNo } from '@/lib/utils/membership-no';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

/**
 * STK Push callback from Safaricom.
 * Must return HTTP 200 immediately — Safaricom retries on any other response.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerIp = getCallerIp(req);

  // Origin check is advisory only — behind Vercel's edge + custom domains the
  // forwarded client IP is not a reliable Safaricom IP, so hard-blocking here
  // drops legitimate callbacks (every payment silently stays pending).
  // Integrity instead comes from: the append-only mpesa_callbacks audit, the
  // UNIQUE(mpesa_receipt_number) idempotency, callbacks only acting on rows the
  // app itself initiated, and reconciliation/STK-Query as source of truth.
  // We log the caller IP so the allow-list can be re-tightened with real values.
  if (!isSafaricomIp(callerIp)) {
    logger.warn('[mpesa/callback] caller IP not in Safaricom allow-list — processing anyway', { callerIp });
  }

  const rawBody  = await req.text();

  let body: StkCallbackBody;
  try {
    body = JSON.parse(rawBody) as StkCallbackBody;
  } catch {
    return ack();
  }

  // Ack-after-durable-audit (ADR-19): the raw callback must be durably
  // persisted BEFORE we return 200. If the audit insert fails (e.g. DB down),
  // a non-200 makes Safaricom retry — previously we acked unconditionally and
  // a callback arriving during an outage was silently lost. The DLQ replay
  // job recovers processing failures from the audit row.
  const callbackId = await logMpesaCallback('stk_push', callerIp, rawBody);
  if (!callbackId && DURABLE_ACK) {
    logger.error('[mpesa/callback] audit write failed — asking Safaricom to retry');
    return NextResponse.json({ ResultCode: 1, ResultDesc: 'Retry' }, { status: 503 });
  }

  after(async () => {
    try {
      const result = await handleSTKCallback(body, callerIp);
      if (result.success && result.paymentId && result.amount) {
        await processFulfillment(result.paymentId, result.amount, result.mpesaReceiptNumber);
      }
      if (callbackId) await markCallbackProcessed(callbackId);
    } catch (err) {
      logger.error('[mpesa/callback] Processing error:', err);
      if (callbackId) await markCallbackError(callbackId, String(err));
    }
  });

  return ack();
}

// Config escape hatch: set MPESA_DURABLE_ACK=false to restore the legacy
// unconditional 200-ack (e.g. while diagnosing audit-table issues).
const DURABLE_ACK = process.env.MPESA_DURABLE_ACK !== 'false';

async function processFulfillment(
  paymentId: string,
  amount: number,
  receipt: string | null,
): Promise<void> {
  const payment = await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      group_id: string; invoice_id: string | null; mpesa_phone: string | null;
    }>('SELECT group_id, invoice_id, mpesa_phone FROM payments WHERE id=$1', [paymentId]);
    return rows[0] ?? null;
  });
  if (!payment) return;

  const ctx = { userId: 'system', groupId: payment.group_id, role: 'chairperson' };

  // Credit SMS balance if this was an SMS top-up payment. The STK request's
  // purpose enum is authoritative — it's set explicitly at initiation and
  // can't drift the way invoice-item wording can. The description ILIKE match
  // survives only as a fallback for legacy rows initiated without a purpose.
  if (payment.invoice_id) {
    const isTopup = await withAdminDb(async (db) => {
      const { rows: stkRows } = await db.query<{ purpose: string | null }>(
        `SELECT s.purpose
         FROM   mpesa_stk_requests s
         JOIN   payments p ON p.mpesa_checkout_request_id = s.checkout_request_id
         WHERE  p.id = $1
         LIMIT  1`,
        [paymentId],
      );
      const purpose = stkRows[0]?.purpose ?? null;
      if (purpose !== null) return purpose === 'sms_topup';

      // Legacy fallback: no purpose recorded — infer from the invoice line.
      const { rows } = await db.query<{ description: string }>(
        `SELECT ii.description FROM invoice_items ii
         WHERE ii.invoice_id=$1 AND ii.description ILIKE '%sms%' LIMIT 1`,
        [payment.invoice_id],
      );
      return !!rows[0];
    });
    if (isTopup) {
      await billingService.addSmsCredits(ctx, amount, paymentId);
    }
  }

  // Receipt context (payment architecture §8 / audit M-2): a multi-group
  // member must always know WHICH membership a payment landed on, so the
  // receipt names the group, the Membership Number, the product, and the
  // updated balance. Enriched only when the payment allocated to a savings
  // contribution; other payments (invoices, top-ups) keep the basic vars and
  // the template engine strips unresolved placeholders.
  const alloc = await withAdminDb(async (db) => {
    const { rows } = await db.query<{
      group_name: string; membership_no: string | null; balance: string;
    }>(
      `SELECT g.name AS group_name, gm.membership_no,
              COALESCE((
                SELECT SUM(c2.amount) FROM contributions c2
                WHERE  c2.group_membership_id = gm.id AND c2.status = 'completed'
              ), 0)::text AS balance
       FROM   contributions c
       JOIN   group_members gm ON gm.id = c.group_membership_id
       JOIN   groups g         ON g.id  = c.group_id
       WHERE  c.payment_id = $1`,
      [paymentId],
    );
    return rows[0] ?? null;
  }).catch(() => null);

  // Notification is decided by sms_trigger_rules, not hardcoded here. The
  // seeded 'payment_received_receipt' rule reproduces the previous message.
  // emitBusinessEvent never throws, and re-emits are idempotent per (rule,
  // paymentId) — so a replayed callback cannot send a second receipt.
  await emitBusinessEvent({
    eventType: SMS_EVENTS.PAYMENT_RECEIVED,
    eventId:   paymentId,
    groupId:   payment.group_id,
    payload: {
      amount,
      receipt: receipt ?? 'N/A',
      phone:   payment.mpesa_phone,
      ...(alloc ? {
        group_name:    alloc.group_name,
        membership_no: alloc.membership_no ? formatMembershipNo(alloc.membership_no) : undefined,
        product:       'savings',
        balance:       Number(alloc.balance).toLocaleString(),
      } : {}),
    },
  });
}

function getCallerIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    '0.0.0.0'
  );
}

function ack(): NextResponse {
  return NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });
}
