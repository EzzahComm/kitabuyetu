export const dynamic = 'force-dynamic'
/**
 * POST /api/v1/mpesa/b2b              â€” Initiate B2B transfer (group_admin+)
 * POST /api/v1/mpesa/b2b?type=result  â€” Safaricom result callback
 * POST /api/v1/mpesa/b2b?type=timeout â€” Safaricom timeout callback
 * GET  /api/v1/mpesa/b2b              â€” List B2B transactions for the group
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import { initiateB2B } from '@/lib/services/daraja.service';
import { handleB2BResult } from '@/lib/services/mpesa.service';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { toMpesaAmount } from '@/lib/utils/currency';
import { logger } from '@/lib/logger';

const B2BSchema = z.object({
  amount:             z.number().positive(),
  receiverShortcode:  z.string().min(3).max(20),
  receiverIdentifier: z.enum(['1', '2', '4']).default('4'),
  commandId:          z.enum(['BusinessBuyGoods', 'BusinessPayBill', 'B2CAccountTopUp']),
  accountReference:   z.string().min(1).max(20),
  remarks:            z.string().min(1).max(100),
  requester:          z.string().optional(),
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

    after(() => {
      withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body) VALUES ($1,$2,$3)`,
          [`b2b_${type}`, ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    after(async () => {
      try { await handleB2BResult(body, ip); }
      catch (err) { logger.error('[b2b result]', err); }
    });
    return ack();
  }

  // Authenticated B2B initiation
  return withRole(req, 'group_admin', async (auth) => {
    try {
      const input = B2BSchema.parse(await req.json());
      const res   = await initiateB2B({
        amount:             input.amount,
        receiverShortcode:  input.receiverShortcode,
        receiverIdentifier: input.receiverIdentifier as '1' | '2' | '4',
        commandId:          input.commandId,
        accountReference:   input.accountReference,
        remarks:            input.remarks,
        requester:          input.requester,
      });

      const amountStr = toMpesaAmount(input.amount).toFixed(2);

      // Persist in both master ledger and B2B-specific table
      const isSandbox = (process.env.MPESA_ENV ?? 'sandbox') !== 'production';
      await withAdminDb(async (db) => {
        const { rows: txRows } = await db.query<{ id: string }>(
          `INSERT INTO mpesa_transactions
             (group_id, transaction_type, direction, amount, status,
              description, conversation_id, originator_conversation_id, is_test)
           VALUES ($1,'b2b','outbound',$2,'initiated',$3,$4,$5,$6)
           RETURNING id`,
          [auth.groupId, amountStr, input.remarks, res.conversationId, res.originatorConversationId, isSandbox],
        );
        await db.query(
          `INSERT INTO mpesa_b2b_transactions
             (group_id, mpesa_transaction_id, conversation_id,
              originator_conversation_id, receiver_shortcode,
              receiver_identifier_type, amount, account_reference,
              command_id, remarks, status, initiated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'initiated',$11)`,
          [
            auth.groupId, txRows[0]?.id ?? null,
            res.conversationId, res.originatorConversationId,
            input.receiverShortcode, input.receiverIdentifier,
            amountStr, input.accountReference,
            input.commandId, input.remarks, auth.userId,
          ],
        );
      });

      return ok({
        conversationId:           res.conversationId,
        originatorConversationId: res.originatorConversationId,
        responseDescription:      res.responseDescription,
        message:                  'B2B transfer initiated. Monitor callback for result.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const rows = await withAdminDb(async (db) => {
        const { rows } = await db.query(
          `SELECT b.*, m.first_name||' '||m.last_name AS initiated_by_name
           FROM mpesa_b2b_transactions b
           LEFT JOIN members m ON m.id=b.initiated_by
           WHERE b.group_id=$1 ORDER BY b.created_at DESC LIMIT 50`,
          [auth.groupId],
        );
        return rows;
      });
      return ok(rows);
    } catch (err) {
      return handleError(err);
    }
  });
}
