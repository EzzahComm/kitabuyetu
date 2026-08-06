export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { RollbackBodySchema } from '@/lib/validators/import.schema';
import { errorResponse, ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ jobId: string }> }

/**
 * POST /api/v1/import/[jobId]/rollback
 * Undoes a committed import. Rollback semantics differ by kind:
 *  - members:       hard DELETE created members; fall back to removing the
 *                   group membership if the member has downstream rows.
 *  - contributions: soft-cancel (UPDATE status='cancelled') — preserves
 *                   audit trail per the financial integrity rule.
 *  - loans:         hard DELETE; blocked per-id if the loan has any
 *                   completed repayments.
 *
 * Body: { reason?: string }. Restricted to chairperson — rollback is a
 * destructive bulk operation and shouldn't be available to secretaries.
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { jobId } = await params;
  return withPermission(req, 'import.rollback', async (auth) => {
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const body   = await req.json().catch(() => ({}));
    const parsed = RollbackBodySchema.parse(body);
    const reason = parsed.reason ?? null;

    const job = await importService.getJob(ctx, jobId);

    if (job.kind === 'members')       return ok(await importService.rollbackMembers(ctx, jobId, reason));
    if (job.kind === 'contributions') return ok(await importService.rollbackContributions(ctx, jobId, reason));
    if (job.kind === 'loans')         return ok(await importService.rollbackLoans(ctx, jobId, reason));

    return errorResponse(`Unsupported import kind: ${job.kind}`, 'VALIDATION_ERROR', 422);
  });
}
