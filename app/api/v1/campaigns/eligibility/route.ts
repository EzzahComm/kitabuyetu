export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withDb } from '@/lib/db';
import { getCampaignOfficerStatus } from '@/lib/services/campaign-officers.service';
import { hasActiveChangishaPlan } from '@/lib/services/campaign-plan.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/campaigns/eligibility — can this group start a campaign? It needs an
 * active Changi$ha plan and the three offices a withdrawal is signed off by (an
 * active chairperson, treasurer and secretary). Drives the checklist on the
 * campaigns page; the same rules are enforced server-side when a campaign is
 * created, submitted and approved (the offices also when withdrawing).
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'campaigns.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(
      await withDb(ctx, async (db) => {
        const officers = await getCampaignOfficerStatus(db, auth.groupId);
        const planActive = await hasActiveChangishaPlan(db, auth.groupId);
        return { ...officers, planActive, eligible: officers.complete && planActive };
      }),
    );
  });
}
