export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/sms/credits — the calling group's own SMS credit balance
 *  (`billing_accounts.sms_credits`) + its effective per-credit rate. Distinct
 *  from GET /sms/balance, which is the platform-wide TextSMS provider account
 *  balance, not any one tenant's credits. `smsService.getBalance` already
 *  existed (used internally by the send path to reject on insufficient
 *  credits) but had no route exposing it to the client. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await smsService.getBalance(ctx));
  });
}
