export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { getContactById, updateContact, listOpportunitiesForContact, listActivitiesForContact } from '@/lib/services/crm.service';
import { ok, notFound, badRequest } from '@/lib/utils/response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const contact = await getContactById(ctx, params.id);
    if (!contact) return notFound('Contact not found');

    const [opportunities, activities] = await Promise.all([
      listOpportunitiesForContact(ctx, params.id),
      listActivitiesForContact(ctx, params.id),
    ]);

    return ok({ contact, opportunities, activities });
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { name, email, phone, notes, contact_type } = body;

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (phone !== undefined) updates.phone = phone;
    if (notes !== undefined) updates.notes = notes;
    if (contact_type !== undefined) updates.contact_type = contact_type;

    if (!Object.keys(updates).length) return badRequest('No fields to update');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const contact = await updateContact(ctx, params.id, updates);

    return ok(contact);
  });
}
