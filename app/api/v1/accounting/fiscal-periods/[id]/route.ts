export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { fiscalPeriodsService } from '@/lib/services/fiscal-periods.service';
import { ReopenPeriodSchema } from '@/lib/validators/accounting.schema';
import { ok } from '@/lib/utils/response';

/** Reopen a closed period. The only mutation this resource supports post-creation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const { id } = await params;
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const input = ReopenPeriodSchema.parse(await req.json());
    return ok(await fiscalPeriodsService.reopen(ctx, id, input));
  });
}
