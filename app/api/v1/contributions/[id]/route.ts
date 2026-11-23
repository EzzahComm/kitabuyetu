import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { contributionsService } from '@/lib/services/contributions.service';
import { ok, confirmedPaymentRequired } from '@/lib/utils/response';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await contributionsService.getById(ctx, id));
  });
}

export function PATCH(req: NextRequest, _context: Ctx): Promise<Response> {
  return withPermission(req, 'contributions.record', async () => confirmedPaymentRequired());
}

export function DELETE(req: NextRequest, _context: Ctx): Promise<Response> {
  return withPermission(req, 'contributions.record', async () => confirmedPaymentRequired());
}
