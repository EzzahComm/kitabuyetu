export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { vendorPaymentsService } from '@/lib/services/vendor-payments.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { VendorPaymentActionSchema } from '@/lib/validators/vendor-payments.schema';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/treasury/vendor-payments/:id */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await vendorPaymentsService.getById(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/treasury/vendor-payments/:id — approve or reject (treasurer+).
 * Maker-checker: the service rejects a decision by the requester.
 * Approval dispatches the Daraja B2C/B2B call for the row's channel.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'treasury.manage');

      const input = VendorPaymentActionSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      if (input.action === 'approve') return ok(await vendorPaymentsService.approve(ctx, id));
      return ok(await vendorPaymentsService.reject(ctx, id, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
