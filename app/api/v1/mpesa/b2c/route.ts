export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import {
  initiateB2C,
  handleB2CResult,
  handleBalanceResult,
  type B2CResultBody,
} from '@/lib/services/mpesa.service';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { ok, handleError } from '@/lib/utils/response';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';

const B2CSchema = z.object({
  phone:     z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  amount:    z.number().int().positive(),
  occasion:  z.string().min(1).max(100),
  commandId: z.enum(['BusinessPayment', 'SalaryPayment', 'PromotionPayment'])
               .default('BusinessPayment'),
  loanId:    z.string().uuid().optional(),
});

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

/** Callbacks from Safaricom (no JWT) and disbursement initiation (treasurer+) */
export async function POST(req: NextRequest): Promise<Response> {
  const type     = req.nextUrl.searchParams.get('type');
  const callerIp = getCallerIp(req);

  if (type === 'result' || type === 'timeout') {
    let body: B2CResultBody;
    try {
      body = await req.json();
    } catch {
      return ack();
    }
    // Log callback
    after(() => {
      withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
           VALUES ($1,$2,$3)`,
          [`b2c_${type}`, callerIp, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    after(async () => {
      try { await handleB2CResult(body, callerIp); } catch (err) {
        logger.error('[b2c result]', err);
      }
    });
    return ack();
  }

  if (type === 'balance_result' || type === 'balance_timeout') {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return ack(); }
    after(async () => {
      try { await handleBalanceResult(body, callerIp); } catch (err) {
        logger.error('[balance result]', err);
      }
    });
    return ack();
  }

  // Authenticated: initiate B2C disbursement
  return withRole(req, 'treasurer', async (auth) => {
    try {
      // Sensitive op (§2.5): outbound money must not ride a stale token.
      await assertAuthFresh(auth);

      const input = B2CSchema.parse(await req.json());
      const result = await initiateB2C({
        phone:       input.phone,
        amount:      input.amount,
        occasion:    input.occasion,
        commandId:   input.commandId,
        groupId:     auth.groupId,
        loanId:      input.loanId,
        disbursedBy: auth.userId,
      });
      return ok({
        conversationId:           result.conversationId,
        originatorConversationId: result.originatorConversationId,
        responseDescription:      result.responseDescription,
        message: 'Disbursement initiated. Monitor the result callback.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
