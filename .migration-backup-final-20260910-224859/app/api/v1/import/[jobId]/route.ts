export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { noContent, ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ jobId: string }> }

/** GET /api/v1/import/[jobId] — fetch a single import job (incl. preview rows). */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { jobId } = await params;
  return withAuth(req, async (auth) => {
    const job = await importService.getJob(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
      jobId,
    );
    return ok(job);
  });
}

/** DELETE /api/v1/import/[jobId] — cancel a 'previewed' job and discard its rows. */
export async function DELETE(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { jobId } = await params;
  return withPermission(req, 'import.cancel', async (auth) => {
    await importService.cancelPreview(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
      jobId,
    );
    return noContent();
  });
}
