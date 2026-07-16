export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { fiscalPeriodsService } from '@/lib/services/fiscal-periods.service';
import { ClosePeriodSchema } from '@/lib/validators/accounting.schema';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await fiscalPeriodsService.list(ctx));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const input = ClosePeriodSchema.parse(await req.json());
    return created(await fiscalPeriodsService.close(ctx, input));
  });
}
