export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { programsService } from '@/lib/services/programs.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/groups/programs/:id — a single published program's detail */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const { id } = await params;
    return ok(await programsService.getProgram(ctx, id));
  });
}
