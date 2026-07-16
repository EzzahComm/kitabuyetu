export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { welfareService, WelfareQuerySchema, CreateWelfareRequestSchema } from '@/lib/services/welfare.service';
import { featureFlagsService } from '@/lib/services/feature-flags.service';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = WelfareQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await featureFlagsService.assertEnabled(ctx, 'welfare_module');
    const result = await welfareService.listRequests(ctx, params);
    return ok(result);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const body  = await req.json();
    const input = CreateWelfareRequestSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    await featureFlagsService.assertEnabled(ctx, 'welfare_module');
    const req_  = await welfareService.createRequest(ctx, input);
    return created(req_);
  });
}
