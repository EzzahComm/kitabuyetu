export const dynamic = 'force-dynamic'
/**
 * POST /api/v1/mpesa/reversal          â€” Initiate reversal (treasurer+)
 * POST /api/v1/mpesa/reversal?type=result  â€” Safaricom callback (no JWT)
 * POST /api/v1/mpesa/reversal?type=timeout â€” Safaricom timeout  (no JWT)
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import { requestReversal } from '@/lib/services/daraja.service';
import { handleReversalResult } from '@/lib/services/mpesa.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

const ReversalSchema = z.object({
  originalReceiptNumber: z.string().min(5).max(50),
  amount:                z.number().positive(),
  receiverParty:         z.string().min(3).max(20),
  remarks:               z.string().min(1).max(100),
  occasion:              z.string().max(100).optional(),
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
          `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
           VALUES ($1,$2,$3)`,
          [`reversal_${type}`, ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    after(async () => {
      try { await handleReversalResult(body, ip); }
      catch (err) { logger.error('[reversal result]', err); }
    });
    return ack();
  }

  // Authenticated reversal initiation (treasurer or above)
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      // Sensitive op (§2.5): reversals move money — re-check epochs, and
      // re-verify against LIVE roles.permissions, not just the token's claim.
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'treasury.manage');

      const input = ReversalSchema.parse(await req.json());

      const res = await requestReversal({
        transactionId:          input.originalReceiptNumber,
        amount:                 input.amount,
        receiverParty:          input.receiverParty,
        receiverIdentifierType: '11',
        remarks:                input.remarks,
        occasion:               input.occasion,
      });

      // Persist reversal record
      const { rows } = await withAdminDb((db) =>
        db.query<{ id: string }>(
          `INSERT INTO mpesa_reversals
             (group_id, original_receipt_number, conversation_id,
              originator_conversation_id, amount, receiver_party,
              remarks, occasion, status, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'initiated',$9)
           RETURNING id`,
          [
            auth.groupId, input.originalReceiptNumber,
            res.conversationId, res.originatorConversationId,
            input.amount.toFixed(2), input.receiverParty,
            input.remarks, input.occasion ?? null, auth.userId,
          ],
        ),
      );

      return ok({
        reversalId:               rows[0].id,
        conversationId:           res.conversationId,
        originatorConversationId: res.originatorConversationId,
        responseDescription:      res.responseDescription,
        message:                  'Reversal request submitted. Result will arrive via callback.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}

/** List reversals for the authenticated group */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const rows = await withAdminDb(async (db) => {
        const { rows } = await db.query(
          `SELECT r.*, m.first_name || ' ' || m.last_name AS requested_by_name
           FROM mpesa_reversals r
           LEFT JOIN members m ON m.id = r.requested_by
           WHERE r.group_id=$1
           ORDER BY r.created_at DESC LIMIT 50`,
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
