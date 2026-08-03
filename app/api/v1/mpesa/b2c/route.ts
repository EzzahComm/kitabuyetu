export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import {
  handleB2CResult,
  handleBalanceResult,
  type B2CResultBody,
} from '@/lib/services/mpesa.service';
import { disbursementsService } from '@/lib/services/disbursements.service';
import { isValidCallbackToken } from '@/lib/services/daraja.service';
import { isValidKenyanPhone } from '@/lib/utils/phone';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
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
    // Callback authenticity (B2C audit H1): a forged callback that doesn't
    // carry the shared secret is dropped before it can touch any money
    // state. Acked (not rejected) so a prober learns nothing from the
    // response, and logged so a real misconfiguration is visible.
    if (!isValidCallbackToken(req.nextUrl.searchParams.get('token'))) {
      logger.warn('[b2c callback] invalid or missing token — dropped', { type, callerIp });
      return ack();
    }

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

  // Authenticated: initiate a disbursement (spine: reserve → maker-checker → dispatch)
  return withPermission(req, 'payouts.manage', async (auth) => {
    try {
      // Sensitive op (§2.5): outbound money must not ride a stale token.
      // Re-verify against LIVE roles.permissions, not just the token's claim.
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'payouts.manage');

      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        return errorResponse(
          'An Idempotency-Key header is required to initiate a disbursement',
          'IDEMPOTENCY_KEY_REQUIRED',
          400,
        );
      }

      const input  = B2CSchema.parse(await req.json());
      const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const result = await disbursementsService.initiateDisbursement(ctx, {
        phone:          input.phone,
        amount:         input.amount,
        occasion:       input.occasion,
        commandId:      input.commandId,
        loanId:         input.loanId,
        idempotencyKey,
      });

      return ok({
        id:               result.id,
        status:           result.status,
        needsApproval:    result.needsApproval,
        message:          result.needsApproval
          ? 'Disbursement submitted — awaiting a second officer\'s approval.'
          : 'Disbursement initiated. Monitor the result callback.',
      });
    } catch (err) {
      return handleError(err);
    }
  });
}
