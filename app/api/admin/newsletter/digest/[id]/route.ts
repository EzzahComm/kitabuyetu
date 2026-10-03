export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import * as newsletterDigestService from '@/lib/services/newsletter-digest.service';
import { UpdateNewsletterDigestSchema } from '@/lib/validators/newsletter-digest.schema';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/newsletter/digest/[id] - a single digest, for the preview screen. Super-admin only. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id } = await params;
    const digest = await newsletterDigestService.getDigest(id);
    return ok(digest);
  });
}

/** PATCH /api/admin/newsletter/digest/[id] - edit a draft's subject/body before sending. Super-admin only. */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id } = await params;
    const input = UpdateNewsletterDigestSchema.parse(await req.json());
    const digest = await newsletterDigestService.updateDraft(id, input);
    return ok(digest);
  });
}
