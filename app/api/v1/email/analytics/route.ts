import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { getEmailAnalytics } from '@/lib/services/delivery-tracking.service';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const days = Number(new URL(req.url).searchParams.get('days') ?? 30);
    const groupId = auth.role === 'super_admin' ? null : auth.groupId;
    const analytics = await getEmailAnalytics(groupId, days);
    return ok(analytics);
  });
}
