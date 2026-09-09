export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { errorResponse, ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ jobId: string }> }

/**
 * POST /api/v1/import/[jobId]/commit
 * Applies a previewed import job. Dispatches to the kind-specific commit
 * method based on the job's `kind` field. Returns the updated job with
 * imported / skipped counts and the per-row errors collected at commit.
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { jobId } = await params;
  return withPermission(req, 'import.commit', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    // Peek at the job to find out what we're committing. getJob throws 404
    // if not found; handleError on the outer chain converts that to JSON.
    const job = await importService.getJob(ctx, jobId);

    if (job.kind === 'members')       return ok(await importService.commitMembers(ctx, jobId));
    if (job.kind === 'contributions') return ok(await importService.commitContributions(ctx, jobId));
    if (job.kind === 'loans')         return ok(await importService.commitLoans(ctx, jobId));

    return errorResponse(`Unsupported import kind: ${job.kind}`, 'VALIDATION_ERROR', 422);
  });
}
