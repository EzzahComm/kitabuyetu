import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { withOrganizationAccess } from '@/lib/auth/middleware';
import { handleWebsiteEnquiry, websiteInbox } from '@/lib/services/website-enquiries.service';
import { ok } from '@/lib/utils/response';
export function GET(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.branding.manage', async (ctx) => ok(await websiteInbox(ctx)));
}
export function PATCH(req: NextRequest) {
  return withOrganizationAccess(req, 'organization.branding.manage', async (ctx) => {
    const { id } = z
      .object({ id: z.string().uuid() })
      .strict()
      .parse(await req.json());
    await handleWebsiteEnquiry(ctx, id);
    return ok({ handled: true });
  });
}
