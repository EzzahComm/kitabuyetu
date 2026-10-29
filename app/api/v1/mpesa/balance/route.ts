export const dynamic = 'force-dynamic';
/**
 * POST /api/v1/mpesa/balance              - REMOVED for tenants (403): it queried the platform shortcode
 * GET  /api/v1/mpesa/balance              - This group's own ledger cash balance (mpesa.view)
 * POST /api/v1/mpesa/balance?type=result  â€” Safaricom async result callback
 * POST /api/v1/mpesa/balance?type=timeout â€” Safaricom timeout callback
 */
import { NextRequest, NextResponse, after } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { isValidCallbackToken } from '@/lib/services/daraja.service';
import { accountingService } from '@/lib/services/accounting.service';
import { handleBalanceResult } from '@/lib/services/mpesa.service';
import { ok, errorResponse, handleError } from '@/lib/utils/response';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';

function callerIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
}

const refuse = () => errorResponse('The platform M-Pesa balance is not available to groups.', 'FORBIDDEN', 403);

const ack = () => NextResponse.json({ ResultCode: 0, ResultDesc: 'Accepted' });

export async function POST(req: NextRequest): Promise<Response> {
  const type = req.nextUrl.searchParams.get('type');
  const ip = callerIp(req);

  if (type === 'result' || type === 'timeout') {
    // Callback authenticity (Phase 4 — same mechanism as B2C/B2B): a forged
    // callback that doesn't carry the shared secret is dropped before it can
    // touch any money state. Acked (not rejected) so a prober learns nothing
    // from the response, and logged so a real misconfiguration is visible.
    if (!isValidCallbackToken(req.nextUrl.searchParams.get('token'))) {
      logger.warn('[balance callback] invalid or missing token — dropped', { type, ip });
      return ack();
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return ack();
    }

    after(() => {
      withAdminDb((db) =>
        db.query(
          `INSERT INTO mpesa_callbacks (callback_type, caller_ip, body)
           VALUES ($1,$2,$3)`,
          [`balance_${type}`, ip, JSON.stringify(body)],
        ),
      ).catch(() => {});
    });

    after(async () => {
      try {
        await handleBalanceResult(body, ip);
      } catch (err) {
        logger.error('[balance result]', err);
      }
    });
    return ack();
  }

  return refuse();
}

/**
 * GET returns THIS group's own cash position from its ledger (1001 Cash and
 * M-Pesa, 1002 Bank), scoped to the caller's group. It used to return the
 * balance of the platform shortcode (MPESA_SHORTCODE), shared by every group,
 * which any treasurer could trigger and read. That Daraja balance is the
 * platform's and is never exposed to a tenant.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'mpesa.view', async (auth) => {
    try {
      const ctx: TenantContext = {
        userId: auth.userId,
        groupId: auth.groupId,
        role: auth.role,
        organizationId: auth.organizationId,
      };
      const balances = await accountingService.getCashBalances(ctx);
      return ok({ ...balances, queriedAt: new Date().toISOString() });
    } catch (err) {
      return handleError(err);
    }
  });
}
