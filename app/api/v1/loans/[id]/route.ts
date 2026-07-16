import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { loansService } from '@/lib/services/loans.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { ApproveLoanSchema, RejectLoanSchema, DisburseLoanSchema, MarkDefaultedSchema, WriteOffLoanSchema } from '@/lib/validators/loan.schema';
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
  return withRole(req, 'treasurer', async (auth) => {
    // Sensitive op (§2.5): loan approval/disbursement must not ride a stale
    // token — re-check role/session epochs against current truth.
    await assertAuthFresh(auth);

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

    return ok({ error: 'Unknown action. Use action: approve | reject | disburse | default | writeOff' }, 400) as Response;
  });
}
