export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { meetingsService, RecordAttendanceSchema } from '@/lib/services/meetings.service';
import { ok } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const body  = await req.json();
    const input = RecordAttendanceSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await meetingsService.recordAttendance(ctx, id, input));
  });
}
