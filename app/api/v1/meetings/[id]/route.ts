export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { meetingsService, UpdateMeetingSchema } from '@/lib/services/meetings.service';
import { ok } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await meetingsService.getById(ctx, id));
  });
}

export async function PATCH(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const body  = await req.json();
    const input = UpdateMeetingSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await meetingsService.update(ctx, id, input));
  });
}
