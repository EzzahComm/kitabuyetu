export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { meetingsService, AddResolutionSchema } from '@/lib/services/meetings.service';
import { created } from '@/lib/utils/response';

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const body  = await req.json();
    const input = AddResolutionSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await meetingsService.addResolution(ctx, id, input));
  });
}
