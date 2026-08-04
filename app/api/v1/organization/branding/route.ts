export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationService } from '@/lib/services/organization.service';
import { BrandingSchema } from '@/lib/validators/organization.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * GET /api/v1/organization/branding — logo + primary color for the enterprise portal.
 * PUT /api/v1/organization/branding — update it (organization_coordinator only).
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.branding.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    return ok(await organizationService.getBranding(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withOrganizationPermission(req, 'organization.branding.manage', async (auth) => {
    try {
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
      const input = BrandingSchema.parse(await req.json());
      return ok(await organizationService.setBranding(ctx, input));
    } catch (err) {
      return handleError(err);
    }
  });
}
