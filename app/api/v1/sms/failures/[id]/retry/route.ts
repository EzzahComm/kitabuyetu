export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { ok, badRequest, notFound } from '@/lib/utils/response';

/**
 * POST /api/v1/sms/failures/[id]/retry — retry one failed message now
 * (SMS-AUDIT-v3 T3-5 / G22).
 *
 * A failed message could previously only be retried by the 5-minute sweep, on
 * its exponential backoff, and never at all once it had burned max_retries —
 * so an officer who fixed the actual cause (topped up, corrected a number,
 * waited out a provider incident) had no way to say "try that one again" and
 * the message stayed permanently undelivered.
 *
 * `messaging.send`, not `messaging.view`: this spends the group's credits and
 * puts a real message on a real phone. It is a send, and it is priced like one.
 *
 * The service runs the same path as the cron sweep, so the opt-out gate and
 * the reserve/settle discipline hold here too — a retry to a number that has
 * since opted out resolves as suppressed and costs nothing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    const result = await smsService.retryFailure(ctx, id);

    switch (result.status) {
      case 'not_found':
        // Also the answer when the row belongs to another group — never
        // distinguish "yours and gone" from "someone else's".
        return notFound('Failed message not found');
      case 'already_resolved':
        return badRequest('That message has already been delivered or suppressed');
      case 'skipped_circuit':
        return badRequest('The SMS provider is currently unavailable — try again shortly');
      default:
        return ok({ status: result.status });
    }
  });
}
