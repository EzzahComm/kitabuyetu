export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { listReminderHistory } from '@/lib/services/reminder.service';
import { ReminderHistoryQuerySchema } from '@/lib/validators/sms.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/sms/reminder-history — which automations ran, for whom, and
 * what happened (SMS-AUDIT-v3 T3-5 / G21).
 *
 * `reminder_dispatch_log` has recorded every automated reminder since
 * migration 106 and had no reader in the product at all: an officer could see
 * that credits were spent, but not which automation spent them, which member
 * it reached, or why a particular member heard nothing. That gap is what makes
 * a data-subject request unanswerable from the product today.
 *
 * SUPPRESSED outcomes are included rather than filtered out — a suppressed row
 * is the evidence that an opt-out was honoured, which is the row a DPA request
 * most needs to see.
 *
 * `messaging.view`, matching /sms/usage: reading what the group sent should
 * not require outranking the person who sent it, and all three officer roles
 * hold this permission. Group scoping comes from the tenant pool's RLS policy
 * (FORCE, group-scoped), not from the handler.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    const params = ReminderHistoryQuerySchema.parse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const history = await listReminderHistory(ctx, params);
    return ok(history);
  });
}
