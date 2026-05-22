export const dynamic = 'force-dynamic'
/**
 * POST /api/v1/mpesa/balance              â€” Trigger balance query (treasurer+)
 * GET  /api/v1/mpesa/balance              â€” Return latest stored balance result
 * POST /api/v1/mpesa/balance?type=result  â€” Safaricom async result callback
 * POST /api/v1/mpesa/balance?type=timeout â€” Safaricom timeout callback
 */
import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { queryAccountBalance } from '@/lib/services/daraja.service';
import { handleBalanceResult } from '@/lib/services/mpesa.service';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

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
          [`balance_${type}`, ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    setImmediate(async () => {
      try { await handleBalanceResult(body, ip); }
      catch (err) { logger.error('[balance result]', err); }
    });
    return ack();
  }

  // Authenticated balance query trigger â€” treasurer, group_admin, or super_admin
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const shortcode = process.env.MPESA_SHORTCODE ?? '';
      const res = await queryAccountBalance(shortcode);

      // Record the query in master ledger so we can correlate the callback
      await withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_transactions
             (group_id, transaction_type, direction, amount, status, description,
              originator_conversation_id, conversation_id)
           VALUES ($1,'balance_query','outbound',0,'initiated','Account balance query',$2,$3)
           ON CONFLICT (originator_conversation_id) DO NOTHING`,
          [auth.groupId, res.originatorConversationId, res.conversationId],
        ),
      );

      return ok({
        conversationId:           res.conversationId,
        originatorConversationId: res.originatorConversationId,
        responseCode:             res.responseCode,
        responseDescription:      res.responseDescription,
        message:                  'Balance query submitted. Result will arrive via callback within 30 seconds.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}

/** Return the latest balance result stored in mpesa_transactions for this group */
export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const rows = await withAdminDb(async (db) => {
        const { rows } = await db.query(
          `SELECT raw_response, completed_at, status
           FROM mpesa_transactions
           WHERE group_id=$1 AND transaction_type='balance_query'
             AND status='completed'
           ORDER BY completed_at DESC LIMIT 1`,
          [auth.groupId],
        );
        return rows;
      });

      if (!rows[0]) return ok(null);

      const raw = rows[0].raw_response as Record<string, unknown>;
      type ResultParam = { Key: string; Value: string | number };
      type BalResult = {
        Result?: {
          ResultParameters?: { ResultParameter?: ResultParam[] };
        };
      };
      const params = (raw as BalResult).Result?.ResultParameters?.ResultParameter ?? [];
      const get    = (k: string) => params.find((p) => p.Key === k)?.Value ?? 0;

      return ok({
        workingAccountBalance:  Number(get('WorkingAccountAvailableFunds')),
        utilityAccountBalance:  Number(get('UtilityAccountAvailableFunds')),
        chargesAccountBalance:  Number(get('ChargesAccountAvailableFunds')),
        queriedAt:              rows[0].completed_at as string,
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
