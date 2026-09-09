export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { BulkPreviewSchema } from '@/lib/validators/sms.schema';
import { ok, badRequest } from '@/lib/utils/response';

/**
 * POST /api/v1/sms/bulk/preview — how many people, and how many credits,
 * BEFORE sending (SMS-AUDIT-v3 T3-5 / G28).
 *
 * Both numbers were previously only discoverable after the fact, by which
 * point the credits are gone and the messages are on real phones. Both have
 * surprised people here before: "Send to All Members" once resolved silently
 * to 20 recipients, and a 200-character message costs two credits per person,
 * not one.
 *
 * POST rather than GET because the audience payload (up to 5,000 phone
 * numbers) does not belong in a query string or a proxy access log — the same
 * reason /sms/bulk is a POST.
 *
 * Read-only: resolves, prices, and returns. Nothing is reserved and nothing is
 * written, so an abandoned preview costs the group nothing.
 *
 * `messaging.send`, not `messaging.view`: the response discloses the group's
 * full reachable recipient count and its balance, and it is only useful to
 * someone about to send. Same permission as the send it precedes.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const parsed = BulkPreviewSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const preview = await smsService.previewBulkSend(ctx, parsed.data);
    return ok(preview);
  });
}
