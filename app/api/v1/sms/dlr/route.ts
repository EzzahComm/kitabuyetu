export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { ok, badRequest } from '@/lib/utils/response';

// GET /api/v1/sms/dlr?messageId=xxx â€” check delivery report
export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'secretary', async () => {
    const messageId = new URL(req.url).searchParams.get('messageId');
    if (!messageId) return badRequest('messageId required');
    const result = await smsService.getDlr(messageId);
    return ok(result);
  });
}
