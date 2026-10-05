export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { updateOnboardingTask } from '@/lib/services/hr-onboarding.service';
import { UpdateOnboardingTaskSchema } from '@/lib/validators/hr-onboarding.schema';
import { ok } from '@/lib/utils/response';

export function PATCH(req: NextRequest, { params }: { params: { taskId: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = UpdateOnboardingTaskSchema.parse(await req.json());
    const task = await updateOnboardingTask(ctx.userId, params.taskId, input);
    return ok(task);
  });
}
