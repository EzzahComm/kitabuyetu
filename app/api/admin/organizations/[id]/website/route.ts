import { readWebsiteJson } from '@/lib/websites/request-body';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { websiteGrant, provisionWebsite } from '@/lib/services/organization-websites.service';
import { siteFields, siteSlug } from '@/lib/websites/content';
import { ok } from '@/lib/utils/response';

type Context = { params: Promise<{ id: string }> };
export function GET(req: NextRequest, { params }: Context) {
  return withPlatformRole(req, 'super_admin', async () =>
    ok(
      await websiteGrant(
        z
          .string()
          .uuid()
          .parse((await params).id),
      ),
    ),
  );
}
export function PUT(req: NextRequest, { params }: Context) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const id = z
      .string()
      .uuid()
      .parse((await params).id);
    const input = z
      .object({ slug: siteSlug, enabled: z.boolean(), editorial: siteFields.optional() })
      .strict()
      .parse(await readWebsiteJson(req));
    return ok(await provisionWebsite(id, input.slug, input.enabled, auth.userId, input.editorial));
  });
}
