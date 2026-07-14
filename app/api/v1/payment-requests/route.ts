export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { paymentRequestsService } from '@/lib/services/payment-requests.service';
import { ok, created, handleError } from '@/lib/utils/response';

const PRODUCTS = [
  'savings', 'loan_repayment', 'welfare', 'share',
  'investment', 'fine', 'registration', 'subscription',
] as const;

const CreateSchema = z.object({
  memberId:       z.string().uuid(),
  product:        z.enum(PRODUCTS),
  amount:         z.number().positive(),
  entityId:       z.string().uuid().optional().nullable(),
  expiresInHours: z.number().int().positive().max(24 * 90).optional().nullable(),
});

const ListSchema = z.object({
  page:     z.coerce.number().int().positive().default(1),
  limit:    z.coerce.number().int().positive().max(100).default(20),
  status:   z.enum(['open', 'fulfilled', 'expired', 'cancelled']).optional(),
  memberId: z.string().uuid().optional(),
});

/** GET /api/v1/payment-requests — list this group's payment requests. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const params = ListSchema.parse(Object.fromEntries(req.nextUrl.searchParams));
      const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      // Members see only their own requests; officers see the group's.
      const scoped = auth.role === 'member'
        ? { ...params, memberId: auth.userId }
        : params;
      return ok(await paymentRequestsService.list(ctx, scoped));
    } catch (err) {
      return handleError(err);
    }
  });
}

/** POST /api/v1/payment-requests — open a request so an inbound payment lands on the intended product (treasurer+). */
export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    try {
      const input = CreateSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return created(await paymentRequestsService.create(ctx, input));
    } catch (err) {
      return handleError(err);
    }
  });
}
