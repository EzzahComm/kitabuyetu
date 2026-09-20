export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { listRuleExecutions } from '@/lib/services/automation-rules.service';
import { ok } from '@/lib/utils/response';

interface Params {
  params: { channel: string; id: string };
}

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const limitParam = new URL(request.url).searchParams.get('limit');
    const limit = limitParam ? Number(limitParam) : undefined;
    const executions = await listRuleExecutions(ctx, params.channel, params.id, limit);
    return ok(executions);
  });
}
