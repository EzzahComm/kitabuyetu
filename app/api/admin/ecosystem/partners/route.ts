export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { createPartner, listPartners } from '@/lib/services/ecosystem.service';
import { ok, created, badRequest } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async () => {
    const partners = await listPartners();
    return ok(partners);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async (ctx) => {
    const body = await request.json();
    const { name, type, description, logo_url, website_url, contact_email, contact_phone } = body;

    if (!name || !type) return badRequest('Missing required fields');

    const partner = await createPartner(
      { userId: ctx.userId },
      { name, type, description, logo_url, website_url, contact_email, contact_phone },
    );

    return created(partner);
  });
}
