export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { SendSmsSchema } from '@/lib/validators/sms.schema';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const body  = await req.json();
    const input = SendSmsSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const logs  = await smsService.send(
      ctx,
      input.phone,
      input.message,
      input.referenceType,
      input.referenceId,
    );
    return ok({ sent: logs.length, logs });
  });
}
