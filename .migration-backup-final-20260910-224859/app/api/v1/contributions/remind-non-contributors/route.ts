export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { contributionsService } from '@/lib/services/contributions.service';
import { ok, handleError } from '@/lib/utils/response';

/** POST /api/v1/contributions/remind-non-contributors — SMS nudge to every
 *  active member with no completed contribution this month (the dashboard's
 *  "Remind" action on the non-contributors task row). Gated the same as the
 *  other SMS-sending routes (`messaging.send`), since this spends SMS
 *  credits. Idempotent per (member, month) via reminder_dispatch_log — safe
 *  to click more than once without double-sending. */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await contributionsService.remindNonContributors(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}
