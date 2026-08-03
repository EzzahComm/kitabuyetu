export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { dividendsService } from '@/lib/services/dividends.service';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'dividends.manage', async (auth) => {
    const decl = await dividendsService.submitForApproval(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id,
    );
    return ok(decl);
  });
}
