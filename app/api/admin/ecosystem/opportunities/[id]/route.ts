export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { getOpportunityById, updateOpportunity, type Opportunity } from '@/lib/services/ecosystem.service';
import { ok, notFound } from '@/lib/utils/response';

type OpportunityUpdates = Partial<
  Pick<
    Opportunity,
    | 'title'
    | 'description'
    | 'category'
    | 'amount_min'
    | 'amount_max'
    | 'terms_summary'
    | 'eligibility_rules'
    | 'application_url'
    | 'featured'
  >
>;

export async function GET(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async () => {
    const opportunity = await withAdminDb((db) => getOpportunityById(db, params.id));
    if (!opportunity) return notFound('Opportunity not found');
    return ok(opportunity);
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async (ctx) => {
    const body = await request.json();
    const {
      title,
      description,
      category,
      amount_min,
      amount_max,
      terms_summary,
      eligibility_rules,
      application_url,
      featured,
    } = body;

    const updates: OpportunityUpdates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (amount_min !== undefined) updates.amount_min = amount_min;
    if (amount_max !== undefined) updates.amount_max = amount_max;
    if (terms_summary !== undefined) updates.terms_summary = terms_summary;
    if (eligibility_rules !== undefined) updates.eligibility_rules = eligibility_rules;
    if (application_url !== undefined) updates.application_url = application_url;
    if (featured !== undefined) updates.featured = featured;

    const opportunity = await updateOpportunity({ userId: ctx.userId }, params.id, updates);
    return ok(opportunity);
  });
}
