export const dynamic = 'force-dynamic'
/**
 * POST /api/v1/mpesa/transaction-status          â€” Query transaction status
 * POST /api/v1/mpesa/transaction-status?type=result  â€” Safaricom callback
 * POST /api/v1/mpesa/transaction-status?type=timeout â€” Safaricom timeout
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { queryTransactionStatus } from '@/lib/services/daraja.service';
import { handleTransactionStatusResult } from '@/lib/services/mpesa.service';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

const QuerySchema = z.object({
  transactionId:  z.string().min(5).max(50),
  partyA:         z.string().optional(),
  identifierType: z.enum(['1', '2', '3', '4']).default('4'),
  remarks:        z.string().max(100).default('Transaction status check'),
});

function callerIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

const ack = () => NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });

export async function POST(req: NextRequest): Promise<Response> {
  const type = req.nextUrl.searchParams.get('type');
  const ip   = callerIp(req);

  if (type === 'result' || type === 'timeout') {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return ack(); }

    setImmediate(() => {
      withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
           VALUES ($1,$2,$3)`,
          [`tx_status_${type}`, ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    setImmediate(async () => {
      try {
        await handleTransactionStatusResult(body, ip);
      } catch (err) {
        logger.error('[tx-status result]', err);
      }
    });

    return ack();
  }

  // Authenticated transaction status query
  return withAuth(req, async (auth) => {
    try {
      const input = QuerySchema.parse(await req.json());
      const shortcode = process.env.MPESA_SHORTCODE ?? '';

      const res = await queryTransactionStatus({
        transactionId:  input.transactionId,
        partyA:         input.partyA ?? shortcode,
        identifierType: input.identifierType as '1' | '2' | '3' | '4',
        remarks:        input.remarks,
      });

      // Record in master ledger
      const isSandbox = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';
      await withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_transactions
             (group_id, transaction_type, direction, amount,
              status, description, originator_conversation_id, conversation_id, is_test)
           VALUES ($1,'transaction_status','inbound',0,'initiated',$2,$3,$4,$5)
           ON CONFLICT (originator_conversation_id) DO NOTHING`,
          [auth.groupId, input.remarks, res.originatorConversationId, res.conversationId, isSandbox],
        ),
      );

      return ok({
        conversationId:           res.conversationId,
        originatorConversationId: res.originatorConversationId,
        responseCode:             res.responseCode,
        responseDescription:      res.responseDescription,
        message:                  'Status query submitted. Result will arrive via callback.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
