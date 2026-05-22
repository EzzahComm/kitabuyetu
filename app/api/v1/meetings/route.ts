export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { meetingsService, MeetingQuerySchema, CreateMeetingSchema } from '@/lib/services/meetings.service';
import { ok, created } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = MeetingQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    if (req.nextUrl.searchParams.get('stats') === '1') {
      return ok(await meetingsService.getStats(ctx));
    }
    return ok(await meetingsService.list(ctx, params));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const body  = await req.json();
    const input = CreateMeetingSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await meetingsService.create(ctx, input));
  });
}
