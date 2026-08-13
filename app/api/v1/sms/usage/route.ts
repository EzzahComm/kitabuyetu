export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { SmsUsageQuerySchema } from '@/lib/validators/sms.schema';
import { summarizeUsageRows } from '@/lib/sms/analytics';
import { ok } from '@/lib/utils/response';

/**
 * Was withRole('treasurer'), which excluded the SECRETARY — the role that in
 * practice does the messaging and already holds messaging.send. Reading how
 * many messages the group has sent should not require outranking the person
 * sending them. messaging.view (migration 140) is the read half of the
 * messaging permission set and is granted to all three officer roles.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    const params  = SmsUsageQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx     = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const [usage, balance] = await Promise.all([
      smsService.listUsage(ctx, params),
      smsService.getBalance(ctx),
    ]);
    const summary = summarizeUsageRows(usage.items);
    return ok({ ...usage, balance, summary });
  });
}
