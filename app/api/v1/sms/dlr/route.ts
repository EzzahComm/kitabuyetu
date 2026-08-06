export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { ok, badRequest } from '@/lib/utils/response';

// GET /api/v1/sms/dlr?messageId=xxx â€” check delivery report
export async function GET(req: NextRequest): Promise<Response> {
  // `messageId` is caller-supplied and provider-issued, so it must be scoped to
  // the caller's own group. Previously this handler took no auth argument at
  // all and passed the raw id straight through, letting any officer of any
  // group read *and* mutate another tenant's sms_usage_logs row
  // (SMS_MESSAGING_AUDIT_2026-08.md C3).
  return withPermission(req, 'messaging.send', async (auth) => {
    const messageId = new URL(req.url).searchParams.get('messageId');
    if (!messageId) return badRequest('messageId required');
    const result = await smsService.getDlr(messageId, { groupId: auth.groupId });
    return ok(result);
  });
}
