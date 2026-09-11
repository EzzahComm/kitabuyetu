export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { listMyGoals, createGoal } from '@/lib/services/member-goals.service';
import { CreateMemberGoalSchema } from '@/lib/validators/member-goal.schema';
import { ok, created } from '@/lib/utils/response';

/** GET /api/v1/me/goals — the signed-in member's own savings goals. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const goals = await listMyGoals(ctx);
    return ok(goals);
  });
}

/** POST /api/v1/me/goals — create a new savings goal. */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const input = CreateMemberGoalSchema.parse(await req.json());
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const goal = await createGoal(ctx, input);
    return created(goal);
  });
}
