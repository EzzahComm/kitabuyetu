export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { smsService } from '@/lib/services/sms.service';
import { ok } from '@/lib/utils/response';
import { z } from 'zod';

const QuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Resolved rows are excluded by default: this screen exists to show what
  // still needs a decision, and a resolved failure needs none.
  includeResolved: z.coerce.boolean().optional(),
});

/**
 * GET /api/v1/sms/failures — messages that failed and have not been resolved
 * (SMS-REAUDIT-2026-09-02 F3/F6).
 *
 * Added because `POST /sms/failures/[id]/retry` shipped without one, so
 * nothing could learn an `[id]` to retry. The retry action was undiscoverable
 * rather than merely un-wired.
 *
 * `messaging.view` to read, matching /sms/usage — seeing which of the group's
 * messages failed is a reporting question. Actually retrying one spends
 * credits and needs `messaging.send`, which the sibling retry route enforces.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.view', async (auth) => {
    const params = QuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await smsService.listFailures(ctx, params));
  });
}
