export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { UpdateShareClassSchema } from '@/lib/validators/shares.schema';
import { ok } from '@/lib/utils/response';

interface RouteParams { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withAuth(req, async (auth) => {
    const cls = await sharesService.getClass(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id,
    );
    return ok(cls);
  });
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<Response> {
  const { id } = await params;
  return withRole(req, 'treasurer', async (auth) => {
    const body  = await req.json();
    const input = UpdateShareClassSchema.parse(body);
    const cls   = await sharesService.updateClass(
      { userId: auth.userId, groupId: auth.groupId, role: auth.role }, id, input,
    );
    return ok(cls);
  });
}
