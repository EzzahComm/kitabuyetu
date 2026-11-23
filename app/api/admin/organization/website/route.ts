import { readWebsiteJson } from '@/lib/websites/request-body';
import { NextRequest } from 'next/server';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { hasWebsiteStudio, websiteStudio, updateWebsite } from '@/lib/services/organization-websites.service';
import { websiteCommand } from '@/lib/websites/content';
import { ok } from '@/lib/utils/response';

export function GET(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.branding.manage', async (ctx) =>
    ok(
      req.nextUrl.searchParams.get('access') === '1'
        ? { available: await hasWebsiteStudio(ctx) }
        : await websiteStudio(ctx),
    ),
  );
}
export function POST(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.branding.manage', async (ctx) =>
    ok(await updateWebsite(ctx, websiteCommand.parse(await readWebsiteJson(req)))),
  );
}
