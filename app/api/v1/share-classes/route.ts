export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { sharesService } from '@/lib/services/shares.service';
import { CreateShareClassSchema } from '@/lib/validators/shares.schema';
import { created, ok } from '@/lib/utils/response';

/** GET /api/v1/share-classes — list share classes for the current group. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx        = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const activeOnly = req.nextUrl.searchParams.get('active') === 'true';
    const items      = await sharesService.listClasses(ctx, { activeOnly });
    return ok({ items });
  });
}

/** POST /api/v1/share-classes — create a new share class (treasurer+). */
export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const body  = await req.json();
    const input = CreateShareClassSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const cls   = await sharesService.createClass(ctx, input);
    return created(cls);
  });
}
