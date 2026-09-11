export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { settlementsService } from '@/lib/services/settlements.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { SettlementActionSchema } from '@/lib/validators/settlements.schema';
import { ok, handleError } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/treasury/settlements/:id */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await settlementsService.getById(ctx, id));
    } catch (err) {
      return handleError(err);
    }
  });
}

/**
 * POST /api/v1/treasury/settlements/:id — approve or reject (treasurer+).
 * Maker-checker: the service rejects a decision by the requester.
 * Approval dispatches the Daraja B2B call.
 */
export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      // Sensitive op: approving executes real money movement to a bank.
      const freshPermissions = await assertAuthFresh(auth);
      requirePermission({ role: auth.role, permissions: freshPermissions }, 'treasury.manage');

      const input = SettlementActionSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

      if (input.action === 'approve') return ok(await settlementsService.approve(ctx, id));
      return ok(await settlementsService.reject(ctx, id, input.reason));
    } catch (err) {
      return handleError(err);
    }
  });
}
