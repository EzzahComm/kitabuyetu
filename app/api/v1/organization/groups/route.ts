export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationService.listGroupSummaries(ctx));
  });
}
