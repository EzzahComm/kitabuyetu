export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { dividendsService } from '@/lib/services/dividends.service';
import { PayAllocationSchema } from '@/lib/validators/dividends.schema';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string; allocId: string }> }

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id, allocId } = await params;
  return withPermission(req, 'dividends.manage', async (auth) => {
    const body  = await req.json();
    const input = PayAllocationSchema.parse(body);
    const alloc = await dividendsService.payAllocation(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
      id, allocId, input,
    );
    return ok(alloc);
  });
}
