export const dynamic = 'force-dynamic';
/**
 * POST /api/v1/mpesa/airtime              — Buy airtime for a phone (group_admin+)
 * POST /api/v1/mpesa/airtime?type=result  — Safaricom result callback (no JWT)
 * POST /api/v1/mpesa/airtime?type=timeout — Safaricom timeout callback (no JWT)
 *
 * The underlying Daraja airtime product is operator-provisioned; the call is
 * gated behind MPESA_AIRTIME_COMMAND_ID and returns 501 until configured.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import { initiateAirtime, handleAirtimeResult } from '@/lib/services/mpesa.service';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

const AirtimeSchema = z.object({
  phone:   z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  amount:  z.number().int().positive(),
  remarks: z.string().max(100).optional(),
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
           VALUES ($1,$2,$3::jsonb)`,
          [`airtime_${type}`, ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    setImmediate(async () => {
      try { await handleAirtimeResult(body, ip); }
      catch (err) { logger.error('[airtime result]', err); }
    });
    return ack();
  }

  // Authenticated airtime purchase (group_admin or above)
  return withRole(req, 'group_admin', async (auth) => {
    try {
      const input = AirtimeSchema.parse(await req.json());
      const res   = await initiateAirtime({
        phone:       input.phone,
        amount:      input.amount,
        remarks:     input.remarks,
        groupId:     auth.groupId,
        initiatedBy: auth.userId,
      });
      return ok({
        conversationId:           res.conversationId,
        originatorConversationId: res.originatorConversationId,
        responseDescription:      res.responseDescription,
        message:                  'Airtime purchase initiated. Monitor the result callback.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
