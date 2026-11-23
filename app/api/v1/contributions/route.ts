export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { contributionsService } from '@/lib/services/contributions.service';
import { ContributionQuerySchema } from '@/lib/validators/contribution.schema';
import { ok, confirmedPaymentRequired } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = ContributionQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await contributionsService.list(ctx, params));
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'contributions.record', async () => confirmedPaymentRequired());
}
