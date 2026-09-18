export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { submitApplication } from '@/lib/services/ecosystem.service';
import { created, badRequest } from '@/lib/utils/response';

export async function POST(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withAuth(request, async (auth) => {
    const body = await request.json();
    const { group_name, group_member_count, group_registration_number, contact_member_name, contact_member_phone, contact_member_email, message } = body;

    if (!group_name || !contact_member_name || !contact_member_phone) {
      return badRequest('Missing required fields');
    }

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const application = await submitApplication(ctx, params.id, auth.groupId, {
      group_name,
      group_member_count,
      group_registration_number,
      contact_member_name,
      contact_member_phone,
      contact_member_email,
      message,
    });

    return created(application);
  });
}
