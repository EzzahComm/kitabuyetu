export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { contributionSplitsService } from '@/lib/services/contribution-splits.service';
import { UpdateContributionSplitSchema } from '@/lib/validators/contribution-splits.schema';
import { ok, handleError } from '@/lib/utils/response';

/** PATCH /api/v1/settings/contribution-splits/[id] — update one rule (treasurer+). */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const { id } = await params;
      const input  = UpdateContributionSplitSchema.parse(await req.json());
      const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const row    = await contributionSplitsService.update(ctx, id, input);
      return ok(row);
    } catch (err) {
      return handleError(err);
    }
  });
}

/** DELETE /api/v1/settings/contribution-splits/[id] — remove one rule (treasurer+). */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const { id } = await params;
      const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      await contributionSplitsService.remove(ctx, id);
      return ok({ deleted: true });
    } catch (err) {
      return handleError(err);
    }
  });
}
