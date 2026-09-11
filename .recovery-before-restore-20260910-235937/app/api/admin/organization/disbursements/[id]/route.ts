export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { DisbursementActionSchema as ActionSchema } from '@/lib/validators/organization.schema';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/organization/disbursements/:id — approve or reject a pending
 * org -> group disbursement (organization_coordinator). Maker-checker: the
 * service rejects approval by the same coordinator who created it.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withOrganizationAccess(req, 'organization.disbursements.manage', async (auth) => {
    try {
      const input = ActionSchema.parse(await req.json());
      const ctx   = {
        userId: auth.userId, groupId: auth.groupId, role: auth.role,
        organizationId: auth.organizationId,
      };

      if (input.action === 'approve') {
        return ok(await organizationFinanceService.approveDisbursement(ctx, id));
      }
      return ok(await organizationFinanceService.rejectDisbursement(ctx, id, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
