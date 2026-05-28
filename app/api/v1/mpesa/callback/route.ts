import { NextRequest, NextResponse, after } from 'next/server';
import {
  handleSTKCallback,
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  type StkCallbackBody,
} from '@/lib/services/mpesa.service';
import { billingService } from '@/lib/services/billing.service';
import { smsService } from '@/lib/services/sms.service';
import { isSafaricomIp } from '@/lib/services/daraja.service';
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

  // Audit-log the raw callback, process it, then mark the audit row
  // processed/errored so the DLQ replay job can pick up genuine failures.
  after(async () => {
    const callbackId = await logMpesaCallback('stk_push', callerIp, rawBody);
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

  const ctx = { userId: 'system', groupId: payment.group_id, role: 'group_admin' };

  // Credit SMS balance if this was an SMS top-up invoice
  if (payment.invoice_id) {
    const isTopup = await withAdminDb(async (db) => {
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

  if (payment.mpesa_phone) {
    try {
      await smsService.send(
        ctx,
        payment.mpesa_phone,
        `KitabuYetu: Payment of KES ${amount} received. Receipt: ${receipt ?? 'N/A'}. Thank you.`,
        'payment',
        paymentId,
      );
    } catch {
      // SMS failure must never block payment completion
    }
  }
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
