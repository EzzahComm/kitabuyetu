export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { RollbackBodySchema } from '@/lib/validators/import.schema';
import { confirmedPaymentRequired, ok } from '@/lib/utils/response';

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

/**
 * POST /api/v1/import/[jobId]/rollback
 * Undoes a committed member import. Removes the membership when downstream
 * records require the member to be preserved.
 *
 * Body: { reason?: string }. Restricted to chairperson — rollback is a
 * destructive bulk operation and shouldn't be available to secretaries.
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { jobId } = await params;
  return withPermission(req, 'import.rollback', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const body = await req.json().catch(() => ({}));
    const parsed = RollbackBodySchema.parse(body);
    const reason = parsed.reason ?? null;

    const job = await importService.getJob(ctx, jobId);

    if (job.kind === 'members') return ok(await importService.rollbackMembers(ctx, jobId, reason));
    return confirmedPaymentRequired();
  });
}
