import type { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
export function GET(req: NextRequest) {
  return withAuth(req, async (auth) => {
    const response = ok({ memberId: auth.userId, groupId: auth.groupId, role: auth.role });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  });
}
