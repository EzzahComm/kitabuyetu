export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { enqueueJob } from '@/lib/jobs';
import { BulkSmsSchema } from '@/lib/validators/sms.schema';
import { resolveSmsRecipients } from '@/lib/services/sms.service';
import { enforceSmsRateLimit } from '@/lib/sms/rate-limit';
import { ValidationError } from '@/lib/utils/errors';
import { ok } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const limited = await enforceSmsRateLimit('bulk', auth.groupId);
    if (limited) return limited;

    const body  = await req.json();
    const input = BulkSmsSchema.parse(body);

    // "Everyone in this group" is resolved here, against the group's own rows,
    // using the same helper the campaign route and the scheduler use — so the
    // three paths cannot disagree about who a group's members are. The client
    // only ever sends phone numbers it was explicitly given by a human.
    const phones = input.recipientType
      ? await resolveSmsRecipients(auth.groupId, input.recipientType, undefined)
      : input.phones ?? [];

    // A membership query that matches nobody is worth saying out loud: it means
    // an empty group or no member holding a phone number, and silently queueing
    // a send to zero recipients would look identical to success.
    if (phones.length === 0) {
      throw new ValidationError(
        'No recipients matched. This group has no members with a phone number on file.',
      );
    }

    // Enqueue durable dispatch — billing, opt-out filtering, log creation and
    // provider calls all happen in the sms_bulk_send job. This replaces the
    // previous in-request dispatch so a large fan-out can't time out the
    // request (and can't be lost to serverless instance termination).
    await enqueueJob(
      'sms_bulk_send',
      {
        phones,
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

    return ok({ queued: phones.length });
  });
}
