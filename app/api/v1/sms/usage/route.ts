export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { SmsUsageQuerySchema } from '@/lib/validators/sms.schema';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const params  = SmsUsageQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx     = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const [usage, balance] = await Promise.all([
      smsService.listUsage(ctx, params),
      smsService.getBalance(ctx),
    ]);
    return ok({ ...usage, balance });
  });
}
