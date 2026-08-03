import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { loansService } from '@/lib/services/loans.service';
import { RecordRepaymentSchema } from '@/lib/validators/loan.schema';
import { ok } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'loans.approve', async (auth) => {
    const input = RecordRepaymentSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await loansService.recordRepayment(ctx, id, input));
  });
}
