export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { settlementsService } from '@/lib/services/settlements.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { CreateSettlementSchema } from '@/lib/validators/settlements.schema';
import { ok, created, handleError, errorResponse } from '@/lib/utils/response';

/** GET /api/v1/treasury/settlements — list this group's settlement sweeps. */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await settlementsService.list(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/treasury/settlements — request a sweep of M-Pesa float to an
 * active bank account. Reserves the funds immediately; a second officer must
 * approve before anything reaches Daraja.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      // Sensitive op: this reserves real funds and queues real money movement.
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'treasury.manage');

      // Same contract as the B2C disbursement route — a client retry must
      // never produce a second real sweep.
      const idempotencyKey = req.headers.get('idempotency-key');
      if (!idempotencyKey) {
        return errorResponse(
          'An Idempotency-Key header is required to request a settlement',
          'IDEMPOTENCY_KEY_REQUIRED',
          400,
        );
      }

      const input = CreateSettlementSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return created(await settlementsService.initiate(ctx, { ...input, idempotencyKey }));
    } catch (err) {
      return handleError(err);
    }
  });
}
