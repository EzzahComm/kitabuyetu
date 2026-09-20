export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { getPartnerById, updatePartner, type Partner } from '@/lib/services/ecosystem.service';
import { ok, notFound } from '@/lib/utils/response';

type PartnerUpdates = Partial<
  Pick<
    Partner,
    'name' | 'type' | 'description' | 'logo_url' | 'website_url' | 'contact_email' | 'contact_phone' | 'is_active'
  >
>;

export async function GET(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async () => {
    const partner = await getPartnerById(params.id);
    if (!partner) return notFound('Partner not found');
    return ok(partner);
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async (ctx) => {
    const body = await request.json();
    const { name, type, description, logo_url, website_url, contact_email, contact_phone, is_active } = body;

    const updates: PartnerUpdates = {};
    if (name !== undefined) updates.name = name;
    if (type !== undefined) updates.type = type;
    if (description !== undefined) updates.description = description;
    if (logo_url !== undefined) updates.logo_url = logo_url;
    if (website_url !== undefined) updates.website_url = website_url;
    if (contact_email !== undefined) updates.contact_email = contact_email;
    if (contact_phone !== undefined) updates.contact_phone = contact_phone;
    if (is_active !== undefined) updates.is_active = is_active;

    const partner = await updatePartner({ userId: ctx.userId }, params.id, updates);
    return ok(partner);
  });
}
