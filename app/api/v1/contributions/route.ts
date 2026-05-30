export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { contributionsService } from '@/lib/services/contributions.service';
import { ContributionQuerySchema, CreateContributionSchema } from '@/lib/validators/contribution.schema';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = ContributionQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await contributionsService.list(ctx, params));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const input = CreateContributionSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const contribution = await contributionsService.create(ctx, input);
    // Fire the member's emailed receipt (best-effort; never blocks the response on failure).
    await contributionsService.notifyReceipt(ctx, contribution);
    return created(contribution);
  });
}
