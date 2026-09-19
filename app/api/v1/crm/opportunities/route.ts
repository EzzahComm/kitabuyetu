export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { listOpportunities, type OpportunityStage } from '@/lib/services/crm.service';
import { ok, badRequest } from '@/lib/utils/response';

const STAGES: OpportunityStage[] = ['draft', 'qualified', 'proposal', 'won', 'lost'];

export async function GET(request: NextRequest): Promise<Response> {
  return withPermission(request, 'crm.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const stageParam = new URL(request.url).searchParams.get('stage');
    if (stageParam && !STAGES.includes(stageParam as OpportunityStage)) return badRequest('Invalid stage');

    const opportunities = await listOpportunities(ctx, { stage: stageParam as OpportunityStage | undefined });
    return ok(opportunities);
  });
}
