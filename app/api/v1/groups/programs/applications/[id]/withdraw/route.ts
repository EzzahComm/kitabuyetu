export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOneOf } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { ok } from '@/lib/utils/response';

/** POST /api/v1/groups/programs/applications/:id/withdraw - chairperson withdraws their group's own open application */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOneOf(req, ['chairperson'], async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const { id } = await params;
    return ok(await programApplicationsService.withdrawApplication(ctx, id));
  });
}
