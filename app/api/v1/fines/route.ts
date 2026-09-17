export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { finesService } from '@/lib/services/fines.service';
import { FineQuerySchema, IssueFineSchema } from '@/lib/validators/fine.schema';
import { ok, created } from '@/lib/utils/response';

/**
 * GET  /api/v1/fines — paginated, filterable by member/status.
 * POST /api/v1/fines — issue a fine against a member.
 *
 * Both gated on 'fines.manage' (migration 112) — the existing chairperson-tier
 * string already used by /api/v1/fines/policy, kept here rather than a new,
 * unregistered permission (see role-permission-catalog.test.ts).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'fines.manage', async (auth) => {
    const params = FineQuerySchema.parse(Object.fromEntries(req.nextUrl.searchParams));
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await finesService.list(ctx, params));
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'fines.manage', async (auth) => {
    const body  = await req.json();
    const input = IssueFineSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return created(await finesService.issue(ctx, input));
  });
}
