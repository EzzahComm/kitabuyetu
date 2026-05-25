export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { dividendsService } from '@/lib/services/dividends.service';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

/** GET /api/v1/dividends/[id]/preview — virtual per-member computation. */
export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const preview = await dividendsService.previewAllocations(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id,
    );
    return ok(preview);
  });
}
