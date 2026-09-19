export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import {
  createAutomationRule, listAutomationRules, type AutomationChannel,
} from '@/lib/services/automation-rules.service';
import { ok, created, badRequest } from '@/lib/utils/response';

const CHANNELS: AutomationChannel[] = ['sms', 'email'];

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const channelParam = new URL(request.url).searchParams.get('channel');
    if (channelParam && !CHANNELS.includes(channelParam as AutomationChannel)) {
      return badRequest("channel must be 'sms' or 'email'");
    }
    const rules = await listAutomationRules(ctx, channelParam as AutomationChannel | undefined);
    return ok(rules);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { channel, name, description, event_type, conditions, template_key, recipient_spec, delay_seconds, max_retries } = body;

    if (!channel || !CHANNELS.includes(channel)) return badRequest("channel must be 'sms' or 'email'");
    if (!name || typeof name !== 'string' || !name.trim()) return badRequest('name is required');
    if (!event_type || typeof event_type !== 'string') return badRequest('event_type is required');
    if (!template_key || typeof template_key !== 'string') return badRequest('template_key is required');
    if (!recipient_spec) return badRequest('recipient_spec is required');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const rule = await createAutomationRule(ctx, channel, {
      name, description, event_type, conditions, template_key, recipient_spec, delay_seconds, max_retries,
    });
    return created(rule);
  });
}
