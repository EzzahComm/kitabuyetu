export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { updateGoal, deleteGoal } from '@/lib/services/member-goals.service';
import { UpdateMemberGoalSchema } from '@/lib/validators/member-goal.schema';
import { ok, noContent } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/v1/me/goals/[id] — update one of the signed-in member's own goals. */
export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const input = UpdateMemberGoalSchema.parse(await req.json());
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const goal = await updateGoal(ctx, id, input);
    return ok(goal);
  });
}

/** DELETE /api/v1/me/goals/[id] — delete one of the signed-in member's own goals. */
export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await deleteGoal(ctx, id);
    return noContent();
  });
}
