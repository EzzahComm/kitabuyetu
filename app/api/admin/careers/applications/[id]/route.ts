export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { getApplicationById, updateApplicationStage } from '@/lib/services/careers.service';
import { UpdateApplicationStageSchema } from '@/lib/validators/careers.schema';
import { ok, notFound } from '@/lib/utils/response';

export function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const application = await getApplicationById(params.id);
    if (!application) return notFound('Application not found');
    return ok(application);
  });
}

export function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = UpdateApplicationStageSchema.parse(await req.json());
    const application = await updateApplicationStage(ctx.userId, params.id, input);
    return ok(application);
  });
}
