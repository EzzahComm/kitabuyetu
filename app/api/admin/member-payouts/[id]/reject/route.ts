export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { memberPayoutsService } from '@/lib/services/member-payouts.service';
import { ok } from '@/lib/utils/response';

const BodySchema = z.object({ reason: z.string().trim().min(5).max(500) });

/** POST — Kitabu Yetu declines: reserved funds return to the group. Super-admin only. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    const { reason } = BodySchema.parse(await req.json());
    return ok(await memberPayoutsService.platformReject(ctx.userId, id, reason));
  });
}
