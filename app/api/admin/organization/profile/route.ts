export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/organization/profile — the coordinator's own organization (name/type). */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationAccess(req, 'organization.profile.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationService.getProfile(ctx));
  });
}
