export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { createCampaign, listCampaigns, type Channel } from '@/lib/services/marketing-campaigns.service';
import { ok, created, badRequest } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const campaigns = await listCampaigns(ctx);
    return ok(campaigns);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { title, message, audience_id, channel, subject } = body;

    if (!title || typeof title !== 'string' || !title.trim()) return badRequest('title is required');
    if (!message || typeof message !== 'string' || !message.trim()) return badRequest('message is required');
    if (!audience_id) return badRequest('audience_id is required');
    if (channel && channel !== 'sms' && channel !== 'email') return badRequest('channel must be sms or email');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const campaign = await createCampaign(ctx, {
      title, message, audience_id, channel: channel as Channel | undefined, subject,
    });
    return created(campaign);
  });
}
