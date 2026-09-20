export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import {
  getOpportunityById, getGroupEligibilityData, evaluateEligibilityDetailed,
} from '@/lib/services/ecosystem.service';
import { ok, notFound } from '@/lib/utils/response';

/**
 * GET — the calling group's eligibility for a published opportunity.
 * Advisory, not enforced: a group that fails a rule can still apply (see
 * ApplicationEligibility component) — this informs, it doesn't gate, since
 * the eligibility DSL (192 lines of range/geo/financial rules) is a partner's
 * stated criteria, not a hard system-level entitlement check the way loan
 * eligibility or subscription entitlements are elsewhere in this codebase.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withAuth(request, async (auth) => {
    return withAdminDb(async (db) => {
      const opportunity = await getOpportunityById(db, params.id);
      if (!opportunity || opportunity.status !== 'published') return notFound('Opportunity not found');

      const groupData = await getGroupEligibilityData(db, auth.groupId);
      if (!groupData) return notFound('Group not found');

      const { matches, failedRules } = await evaluateEligibilityDetailed(opportunity, groupData);
      return ok({
        matches,
        failedRules: failedRules.map((r) => ({ id: r.id, name: r.name, error_message: r.error_message })),
      });
    });
  });
}
