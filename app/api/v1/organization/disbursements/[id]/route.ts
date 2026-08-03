export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withOrganizationPermission } from '@/lib/auth/middleware';
import { organizationFinanceService } from '@/lib/services/organization-finance.service';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({ action: z.literal('reject'), reason: z.string().min(5).max(500) }),
]);

/**
 * POST /api/v1/organization/disbursements/:id — approve or reject a pending
 * org -> group disbursement (organization_coordinator). Maker-checker: the
 * service rejects approval by the same coordinator who created it.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withOrganizationPermission(req, 'organization.disbursements.manage', async (auth) => {
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
