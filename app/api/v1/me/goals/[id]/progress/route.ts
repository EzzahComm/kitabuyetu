export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { logProgress } from '@/lib/services/member-goals.service';
import { LogGoalProgressSchema } from '@/lib/validators/member-goal.schema';
import { ok } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** POST /api/v1/me/goals/[id]/progress — log manual progress toward one of the signed-in member's own goals. */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const input = LogGoalProgressSchema.parse(await req.json());
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const goal = await logProgress(ctx, id, input);
    return ok(goal);
  });
}
