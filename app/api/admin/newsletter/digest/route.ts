export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import * as newsletterDigestService from '@/lib/services/newsletter-digest.service';
import { ComposeNewsletterDigestSchema } from '@/lib/validators/newsletter-digest.schema';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/newsletter/digest — recent digests. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const digests = await newsletterDigestService.listDigests();
    return ok(digests);
  });
}

/**
 * POST /api/admin/newsletter/digest — compose a new draft from the chosen
 * starter marketing template and persist it. Does not send anything; the
 * admin reviews/edits the draft and calls .../[id]/send separately.
 */
export function POST(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { templateKey } = ComposeNewsletterDigestSchema.parse(await req.json());
    const content = newsletterDigestService.composeDigestContent(templateKey);
    const digest = await newsletterDigestService.createDraft(ctx.userId, content);
    return ok(digest);
  });
}
