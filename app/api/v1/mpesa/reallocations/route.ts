export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole } from '@/lib/auth/middleware';
import { reallocationsService } from '@/lib/services/reallocations.service';
import { assertAuthFresh } from '@/lib/services/membership-guard';
import { ok, created, handleError } from '@/lib/utils/response';

const InitiateSchema = z.object({
  contributionId: z.string().uuid(),
  toMemberId:     z.string().uuid(),
  reason:         z.string().min(5).max(500),
});

const ListSchema = z.object({
  page:   z.coerce.number().int().positive().default(1),
  limit:  z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(['pending_approval', 'executed', 'rejected']).optional(),
});

/** GET /api/v1/mpesa/reallocations — correction history + approval queue (treasurer+). */
export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const params = ListSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
      const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await reallocationsService.list(ctx, params));
    } catch (err) {
      return handleError(err);
    }
  });
}

/** POST /api/v1/mpesa/reallocations — initiate a correction (treasurer+). */
export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      // Sensitive op (§2.5): corrections move money between members.
      await assertAuthFresh(auth);

      const input = InitiateSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return created(await reallocationsService.initiate(ctx, input));
    } catch (err) {
      return handleError(err);
    }
  });
}
