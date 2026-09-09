export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { listMyPassbook } from '@/lib/services/member-passbook.service';
import { MemberPassbookQuerySchema } from '@/lib/validators/member-passbook.schema';
import { ok } from '@/lib/utils/response';

/** GET /api/v1/me/passbook — the signed-in member's own paginated transaction history. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const params = MemberPassbookQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const page = await listMyPassbook(ctx, params);
    return ok(page);
  });
}
