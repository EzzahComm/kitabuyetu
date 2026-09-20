export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { createContact, listContacts, type ContactType } from '@/lib/services/crm.service';
import { ok, created, badRequest } from '@/lib/utils/response';

const CONTACT_TYPES: ContactType[] = [
  'donor',
  'lender',
  'insurer',
  'trainer',
  'service_provider',
  'professional',
  'partner_rep',
  'lead',
  'media',
  'government',
  'other',
];

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const { searchParams } = new URL(request.url);
    const contactType = searchParams.get('contact_type') as ContactType | null;
    const optInParam = searchParams.get('marketing_opt_in');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const contacts = await listContacts(ctx, {
      contact_type: contactType && CONTACT_TYPES.includes(contactType) ? contactType : undefined,
      marketing_opt_in: optInParam === null ? undefined : optInParam === 'true',
    });

    return ok(contacts);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { contact_type, name, email, phone, notes, donor_id, ecosystem_partner_id, marketing_opt_in } = body;

    if (!contact_type || !CONTACT_TYPES.includes(contact_type)) {
      return badRequest('A valid contact_type is required');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      return badRequest('name is required');
    }

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const contact = await createContact(ctx, {
      contact_type,
      name,
      email,
      phone,
      notes,
      donor_id,
      ecosystem_partner_id,
      marketing_opt_in: marketing_opt_in === true,
    });

    return created(contact);
  });
}
