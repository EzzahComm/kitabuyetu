export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { updateApplicationStatus } from '@/lib/services/ecosystem.service';
import { ok, badRequest } from '@/lib/utils/response';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'admin', async (auth) => {
    const body = await request.json();
    const { status, response_message } = body;

    if (!status || !['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn'].includes(status)) {
      return badRequest('Invalid status');
    }

    const ctx = { organizationId: auth.organizationId, userId: auth.userId, ipAddress: request.ip };
    const application = await updateApplicationStatus(ctx, params.id, status, response_message);

    return ok(application);
  });
}
