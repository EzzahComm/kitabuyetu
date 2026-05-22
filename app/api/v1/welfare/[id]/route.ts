export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { welfareService, ReviewWelfareRequestSchema, DisburseWelfareSchema } from '@/lib/services/welfare.service';
import { ok } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await welfareService.getById(ctx, id));
  });
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const body = await req.json();
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (body.action === 'disburse') {
      const input = DisburseWelfareSchema.parse(body);
      return ok(await welfareService.disburse(ctx, id, input));
    }
    const input = ReviewWelfareRequestSchema.parse(body);
    return ok(await welfareService.reviewRequest(ctx, id, input));
  });
}
