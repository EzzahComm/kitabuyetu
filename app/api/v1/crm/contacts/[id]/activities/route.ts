export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { logActivityForContact, type ActivityType } from '@/lib/services/crm.service';
import { created, badRequest } from '@/lib/utils/response';

const ACTIVITY_TYPES: ActivityType[] = ['call', 'email', 'sms', 'meeting', 'note', 'task'];

export async function POST(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { activity_type, body: activityBody } = body;

    if (!activity_type || !ACTIVITY_TYPES.includes(activity_type)) {
      return badRequest('A valid activity_type is required');
    }

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const activity = await logActivityForContact(ctx, {
      contact_id: params.id,
      activity_type,
      body: activityBody,
    });

    return created(activity);
  });
}
