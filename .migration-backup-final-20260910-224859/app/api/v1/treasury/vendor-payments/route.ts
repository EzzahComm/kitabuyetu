export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { vendorPaymentsService } from '@/lib/services/vendor-payments.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { CreateVendorPaymentSchema } from '@/lib/validators/vendor-payments.schema';
import { ok, created, handleError, errorResponse } from '@/lib/utils/response';

/** GET /api/v1/treasury/vendor-payments — list this group's vendor payments. */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await vendorPaymentsService.list(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/treasury/vendor-payments — request a payment to an external
 * vendor. Reserves the funds immediately; a second officer must approve
 * before anything reaches Daraja.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'treasury.manage');

      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        return errorResponse(
          'An Idempotency-Key header is required to request a vendor payment',
          'IDEMPOTENCY_KEY_REQUIRED',
          400,
        );
      }

      const input = CreateVendorPaymentSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return created(await vendorPaymentsService.initiate(ctx, { ...input, idempotencyKey }));
    } catch (err) {
      return handleError(err);
    }
  });
}
