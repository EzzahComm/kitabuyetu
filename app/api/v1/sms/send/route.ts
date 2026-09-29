export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { SendSmsSchema } from '@/lib/validators/sms.schema';
import { enforceSmsRateLimit } from '@/lib/sms/rate-limit';
import { emitSmsManualSend } from '@/lib/notifications';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const limited = await enforceSmsRateLimit('send', auth.groupId);
    if (limited) return limited;

    const body = await req.json();
    const input = SendSmsSchema.parse(body);
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const logs = await smsService.send(ctx, input.phone, input.message, input.referenceType, input.referenceId);
    await emitSmsManualSend({
      groupId: auth.groupId,
      userId: auth.userId,
      message: input.message,
      recipients: logs.length,
      reference: logs[0]?.id ?? crypto.randomUUID(),
    });
    return ok({ sent: logs.length, logs });
  });
}
