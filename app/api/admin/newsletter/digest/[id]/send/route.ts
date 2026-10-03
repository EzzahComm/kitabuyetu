export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import * as newsletterDigestService from '@/lib/services/newsletter-digest.service';
import { ok } from '@/lib/utils/response';

/**
 * POST /api/admin/newsletter/digest/[id]/send — the explicit fire action.
 * Snapshots the current active-subscriber list and flips the digest to
 * 'sending'; actual delivery happens on the next job-queue tick (see
 * newsletter-digest.service.ts's sendDigest). Super-admin only.
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { id } = await params;
    const digest = await newsletterDigestService.sendDigest(id, ctx.userId);
    return ok(digest);
  });
}
