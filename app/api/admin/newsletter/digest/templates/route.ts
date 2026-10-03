export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { listMarketingTemplates } from '@/lib/services/newsletter-digest.service';
import { ok } from '@/lib/utils/response';

/** GET /api/admin/newsletter/digest/templates - starter templates to compose a digest from. Super-admin only. */
export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(listMarketingTemplates());
  });
}
