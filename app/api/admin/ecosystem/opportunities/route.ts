export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { createOpportunity, listAllOpportunities } from '@/lib/services/ecosystem.service';
import { ok, created, badRequest } from '@/lib/utils/response';

export async function GET(request: NextRequest): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async () => {
    const opportunities = await listAllOpportunities();
    return ok(opportunities);
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  return withPlatformRole(request, 'super_admin', async (ctx) => {
    const body = await request.json();
    const {
      partner_id,
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
    } = body;

    if (!partner_id || !title || !description || !opportunity_type || !eligibility_rules) {
      return badRequest('Missing required fields');
    }

    const opportunity = await createOpportunity({ userId: ctx.userId }, partner_id, {
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
