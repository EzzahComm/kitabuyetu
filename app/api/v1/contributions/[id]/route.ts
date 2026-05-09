import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { contributionsService } from '@/lib/services/contributions.service';
import { UpdateContributionSchema } from '@/lib/validators/contribution.schema';
import { ok, noContent } from '@/lib/utils/response';

type Ctx = { params: { id: string } };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await contributionsService.getById(ctx, params.id));
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const input = UpdateContributionSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await contributionsService.update(ctx, params.id, input));
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await contributionsService.delete(ctx, params.id);
    return noContent();
  });
}
