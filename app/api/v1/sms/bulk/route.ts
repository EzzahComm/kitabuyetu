export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { BulkSmsSchema } from '@/lib/validators/sms.schema';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'secretary', async (auth) => {
    const body  = await req.json();
    const input = BulkSmsSchema.parse(body);
    const result = await smsService.sendBulkCampaign({
      phones:        input.phones,
      message:       input.message,
      senderId:      input.senderId,
      timeToSend:    input.timeToSend,
      groupId:       auth.groupId,
      sentBy:        auth.userId,
      referenceType: input.referenceType ?? undefined,
      referenceId:   input.referenceId ?? undefined,
    });
    return ok(result);
  });
}
