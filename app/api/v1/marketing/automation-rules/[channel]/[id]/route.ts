export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { getAutomationRule, updateAutomationRule } from '@/lib/services/automation-rules.service';
import { ok, notFound } from '@/lib/utils/response';

interface Params {
  params: { channel: string; id: string };
}

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const rule = await getAutomationRule(ctx, params.channel, params.id);
    if (!rule) return notFound('Automation rule not found');
    return ok(rule);
  });
}

export async function PATCH(request: NextRequest, { params }: Params): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { description, conditions, template_key, recipient_spec, delay_seconds, max_retries, is_active } = body;

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const rule = await updateAutomationRule(ctx, params.channel, params.id, {
      description,
      conditions,
      template_key,
      recipient_spec,
      delay_seconds,
      max_retries,
      is_active,
    });
    return ok(rule);
  });
}
