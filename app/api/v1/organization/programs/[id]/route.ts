export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ProgramActionSchema, UpdateProgramStatusSchema } from '@/lib/validators/organization.schema';
import { ok } from '@/lib/utils/response';

/**
 * PATCH /api/v1/organization/programs/:id — pause / reactivate / close
 * POST  /api/v1/organization/programs/:id — capitalize / decapitalize
 *
 * Capital adjustment is a POST rather than another PATCH branch because it is
 * not a state change on the row — it moves the product's spending authority,
 * and is separately permissioned (capital.product.manage vs
 * organization.programs.manage).
 */

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withOrganizationPermission(req, 'organization.programs.manage', async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const { status } = UpdateProgramStatusSchema.parse(await req.json());
    return ok(await organizationFinanceService.updateProgramStatus(ctx, id, status));
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return withOrganizationPermission(req, 'capital.product.manage', async (auth) => {
    const { id } = await params;
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const body = ProgramActionSchema.parse(await req.json());

    if (body.action === 'capitalize') {
      return ok(await organizationFinanceService.capitalizeProduct(ctx, id, body));
    }
    return ok(await organizationFinanceService.decapitalizeProduct(ctx, id, body));
  });
}
