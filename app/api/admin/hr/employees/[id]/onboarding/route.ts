export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listOnboardingTasks, addOnboardingTask } from '@/lib/services/hr-onboarding.service';
import { AddOnboardingTaskSchema } from '@/lib/validators/hr-onboarding.schema';
import { ok, created } from '@/lib/utils/response';

export function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const tasks = await listOnboardingTasks(params.id);
    return ok(tasks);
  });
}

export function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = AddOnboardingTaskSchema.parse(await req.json());
    const task = await addOnboardingTask(ctx.userId, params.id, input);
    return created(task);
  });
}
