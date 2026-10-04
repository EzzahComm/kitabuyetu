export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withDb } from '@/lib/db';
import { getCampaignOfficerStatus } from '@/lib/services/campaign-officers.service';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/campaigns/eligibility — does this group have the three offices a
 * campaign needs (an active chairperson, treasurer and secretary)? Drives the
 * checklist on the campaigns page; the same rule is enforced server-side when a
 * campaign is created, submitted, approved and withdrawn from.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'campaigns.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await withDb(ctx, (db) => getCampaignOfficerStatus(db, auth.groupId)));
  });
}
