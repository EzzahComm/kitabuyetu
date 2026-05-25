export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const summary = await sharesService.getGroupSummary(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role },
    );
    return ok(summary);
  });
}
