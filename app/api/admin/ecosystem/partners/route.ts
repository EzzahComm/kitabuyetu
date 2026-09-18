export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { createPartner, listPartners } from '@/lib/services/ecosystem.service';
import { ok, created, badRequest } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'admin', async (auth) => {
    const ctx = { userId: auth.userId, groupId: '', role: auth.role, organizationId: auth.organizationId };
    const partners = await listPartners(ctx);
    return ok({ partners, count: partners.length });
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPermission(request, 'admin', async (auth) => {
    const body = await request.json();
    const { name, type, description, logo_url, website_url, contact_email, contact_phone } = body;

    if (!name || !type) return badRequest('Missing required fields');

    const ctx = { userId: auth.userId, groupId: '', role: auth.role, organizationId: auth.organizationId };
    const partner = await createPartner(ctx, { name, type, description, logo_url, website_url, contact_email, contact_phone });

    return created(partner);
  });
}
