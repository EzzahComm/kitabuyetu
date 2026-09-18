export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { createOpportunity } from '@/lib/services/ecosystem.service';
import { created, badRequest } from '@/lib/utils/response';

export async function POST(request: NextRequest): Promise<Response> {
  return withPermission(request, 'admin', async (auth) => {
    const body = await request.json();
    const { partner_id, title, description, opportunity_type, category, amount_min, amount_max, currency, terms_summary, eligibility_rules, application_url, featured } = body;

    if (!partner_id || !title || !description || !opportunity_type || !eligibility_rules) {
      return badRequest('Missing required fields');
    }

    const ctx = { userId: auth.userId, groupId: '', role: auth.role, organizationId: auth.organizationId };
    const opportunity = await createOpportunity(ctx, partner_id, {
      title,
      description,
      opportunity_type,
      category,
      amount_min,
      amount_max,
      currency,
      terms_summary,
      eligibility_rules,
      application_url,
      featured,
    });

    return created(opportunity);
  });
}
