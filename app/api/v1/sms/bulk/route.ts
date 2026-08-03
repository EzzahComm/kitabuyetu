export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { enqueueJob } from '@/lib/jobs';
import { BulkSmsSchema } from '@/lib/validators/sms.schema';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const body  = await req.json();
    const input = BulkSmsSchema.parse(body);

    // Enqueue durable dispatch — billing, opt-out filtering, log creation and
    // provider calls all happen in the sms_bulk_send job. This replaces the
    // previous in-request dispatch so a large fan-out can't time out the
    // request (and can't be lost to serverless instance termination).
    await enqueueJob(
      'sms_bulk_send',
      {
        phones:        input.phones,
        message:       input.message,
        senderId:      input.senderId,
        timeToSend:    input.timeToSend,
        groupId:       auth.groupId,
        sentBy:        auth.userId,
        referenceType: input.referenceType ?? undefined,
        referenceId:   input.referenceId ?? undefined,
      },
      { priority: 7, max_attempts: 3 },
    );

    return ok({ queued: input.phones.length });
  });
}
