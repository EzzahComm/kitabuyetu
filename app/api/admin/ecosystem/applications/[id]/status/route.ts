export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { updateApplicationStatus } from '@/lib/services/ecosystem.service';
import { ok, badRequest } from '@/lib/utils/response';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async (ctx) => {
    const body = await request.json();
    const { status, response_message } = body;

    if (!status || !['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn'].includes(status)) {
      return badRequest('Invalid status');
    }

    const application = await updateApplicationStatus({ userId: ctx.userId }, params.id, status, response_message);

    return ok(application);
  });
}
