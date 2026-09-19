export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { updateOpportunity, type OpportunityStage } from '@/lib/services/crm.service';
import { ok, badRequest } from '@/lib/utils/response';

const STAGES: OpportunityStage[] = ['draft', 'qualified', 'proposal', 'won', 'lost'];

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPermission(request, 'crm.manage', async (auth) => {
    const body = await request.json();
    const { title, stage, amount, notes } = body;

    if (stage !== undefined && !STAGES.includes(stage)) return badRequest('Invalid stage');

    const updates: Record<string, unknown> = {};
    if (title !== undefined) updates.title = title;
    if (stage !== undefined) updates.stage = stage;
    if (amount !== undefined) updates.amount = amount;
    if (notes !== undefined) updates.notes = notes;

    if (!Object.keys(updates).length) return badRequest('No fields to update');

    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const opportunity = await updateOpportunity(ctx, params.id, updates);
    return ok(opportunity);
  });
}
