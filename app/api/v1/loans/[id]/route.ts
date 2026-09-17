import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { loansService } from '@/lib/services/loans.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { requirePermission } from '@/lib/auth/permissions';
import { ApproveLoanSchema, RejectLoanSchema, DisburseLoanSchema, MarkDefaultedSchema, WriteOffLoanSchema } from '@/lib/validators/loan.schema';
import { WaiveChargeSchema } from '@/lib/validators/loan-charge.schema';
import { loanChargesService } from '@/lib/services/loan-charges.service';
import { ok } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await loansService.getById(ctx, id));
  });
}

export async function PATCH(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'loans.approve', async (auth) => {
    // Sensitive op (§2.5): loan approval/disbursement must not ride a stale
    // token — re-check role/session epochs against current truth, and
    // re-verify the permission against the LIVE roles.permissions rather
    // than the token's own (bounded-stale) claim.
    const freshPermissions = await assertAuthFresh(auth);
    requirePermission({ role: auth.role, permissions: freshPermissions }, 'loans.approve');

    const body   = await req.json();
    const action = body.action as string;
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (action === 'approve') {
      const input = ApproveLoanSchema.parse(body);
      return ok(await loansService.approve(ctx, id, input));
    }
    if (action === 'reject') {
      const input = RejectLoanSchema.parse(body);
      return ok(await loansService.reject(ctx, id, input));
    }
    if (action === 'disburse') {
      const input = DisburseLoanSchema.parse(body);
      return ok(await loansService.disburse(ctx, id, input));
    }
    if (action === 'default') {
      const input = MarkDefaultedSchema.parse(body);
      return ok(await loansService.markDefaulted(ctx, id, input));
    }
    if (action === 'writeOff') {
      const input = WriteOffLoanSchema.parse(body);
      return ok(await loansService.writeOff(ctx, id, input));
    }
    if (action === 'waiveCharge') {
      // body.chargeId, not the loan `id` in the path — a loan_charges row has
      // its own id (migration 179). Same permission bar as every other
      // officer action on this route.
      const input = WaiveChargeSchema.parse(body);
      return ok(await loanChargesService.waiveCharge(ctx, input.chargeId, input.reason));
    }

    return ok({ error: 'Unknown action. Use action: approve | reject | disburse | default | writeOff | waiveCharge' }, 400) as Response;
  });
}
