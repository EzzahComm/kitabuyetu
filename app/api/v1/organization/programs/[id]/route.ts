export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok } from '@/lib/utils/response';

/** PATCH /api/v1/organization/programs/:id — pause / reactivate / close */

const UpdateSchema = z.object({
  status: z.enum(['active', 'paused', 'closed']),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const { status } = UpdateSchema.parse(await req.json());
    return ok(await organizationFinanceService.updateProgramStatus(ctx, id, status));
  });
}
