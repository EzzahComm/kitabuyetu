import { NextRequest, NextResponse } from 'next/server';
import { handleSTKCallback, type StkCallbackBody } from '@/lib/services/mpesa.service';
import { billingService } from '@/lib/services/billing.service';
import { smsService } from '@/lib/services/sms.service';
import { withAdminDb } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Safaricom's published egress IPs for Daraja callbacks.
 * Source: https://developer.safaricom.co.ke/docs#ip-addresses
 * Reject any POST that does not originate from this set (production only).
 */
const SAFARICOM_IPS = new Set([
  '196.201.214.200',
  '196.201.214.206',
  '196.201.213.114',
  '196.201.214.207',
  '196.201.214.208',
  '196.201.213.44',
  '196.201.212.127',
  '196.201.212.138',
  '196.201.212.129',
  '196.201.212.136',
  '196.201.212.74',
  '196.201.212.69',
]);

/**
 * STK Push callback from Safaricom.
 * Must return HTTP 200 immediately — Safaricom retries on any other response.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const callerIp = getCallerIp(req);

  // Validate origin before parsing the body.
  // In sandbox we skip IP validation (Safaricom sandbox uses different IPs).
  if (process.env.MPESA_ENV === 'production' && !SAFARICOM_IPS.has(callerIp)) {
    return NextResponse.json(
      { ResultCode: 1, ResultDesc: 'Rejected' },
      { status: 403 },
    );
  }

  const rawBody  = await req.text();

  let body: StkCallbackBody;
  try {
    body = JSON.parse(rawBody) as StkCallbackBody;
  } catch {
    return ack();
  }

  // Log raw callback for audit trail — fire and forget
  setImmediate(() => {
    withAdminDb((db) =>
      db.query(
        `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
         VALUES ('stk_push',$1,$2)`,
        [callerIp, rawBody],
      ),
    ).catch(() => {});
  });

  setImmediate(async () => {
    try {
      const result = await handleSTKCallback(body, callerIp);
      if (result.success && result.paymentId && result.amount) {
        await processFulfillment(result.paymentId, result.amount, result.mpesaReceiptNumber);
      }
    } catch (err) {
      console.error('[mpesa/callback] Processing error:', err);
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
