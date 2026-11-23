export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { importService } from '@/lib/services/import.service';
import { ok, confirmedPaymentRequired } from '@/lib/utils/response';

/**
 * GET /api/v1/import — list this group's import jobs (most recent first).
 * Optional ?kind=members and ?limit / ?offset.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const sp = req.nextUrl.searchParams;
    const result = await importService.listJobs(ctx, {
      kind: sp.get('kind') ?? undefined,
      limit: sp.get('limit') ? parseInt(sp.get('limit')!, 10) : undefined,
      offset: sp.get('offset') ? parseInt(sp.get('offset')!, 10) : undefined,
    });
    return ok(result);
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'import.start', async () => confirmedPaymentRequired());
}
