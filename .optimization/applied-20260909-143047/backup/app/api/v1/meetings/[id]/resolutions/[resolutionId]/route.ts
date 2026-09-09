export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { meetingsService, UpdateResolutionSchema } from '@/lib/services/meetings.service';
import { ok } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string; resolutionId: string }> };

/**
 * Mark a resolution implemented, or amend its follow-through details.
 *
 * `meeting_resolutions.implemented` has existed since migration 023 with no
 * write path anywhere — this is it. The service scopes the update by meeting
 * AND group, so a resolution id belonging to another meeting or another
 * tenant is not reachable here.
 */
export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const { id, resolutionId } = await params;
  return withPermission(req, 'meetings.manage', async (auth) => {
    const body  = await req.json();
    const input = UpdateResolutionSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await meetingsService.updateResolution(ctx, id, resolutionId, input));
  });
}
