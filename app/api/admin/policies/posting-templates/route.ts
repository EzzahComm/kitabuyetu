export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { postingTemplatesService } from '@/lib/services/posting-templates.service';
import { SetPostingTemplateSchema } from '@/lib/validators/accounting.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/admin/policies/posting-templates — platform-wide posting templates.
 * PUT /api/admin/policies/posting-templates — set a platform-wide default
 *   (super_admin only; restricted to standard chart codes).
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(await withAdminDb((client) => postingTemplatesService.getPlatformTemplates(client)));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const input = SetPostingTemplateSchema.parse(await req.json());
    await withAdminDb((client) => postingTemplatesService.setPlatformDefault(auth.userId, client, input.event, input.lines));
    return ok(await withAdminDb((client) => postingTemplatesService.getPlatformTemplates(client)));
  });
}
