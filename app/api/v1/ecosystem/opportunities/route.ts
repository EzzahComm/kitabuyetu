export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { listPublishedOpportunities, toPublicOpportunity } from '@/lib/services/ecosystem.service';
import { ok } from '@/lib/utils/response';

// Public, unauthenticated route — never return eligibility_rules here.
export async function GET(request: NextRequest): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const category = searchParams.get('category');
  const featured = searchParams.get('featured') === 'true';

  return withAdminDb(async (db) => {
    const opportunities = await listPublishedOpportunities(db, {
      type: type || undefined,
      category: category || undefined,
      featured_only: featured,
    });

    const publicOpportunities = opportunities.map(toPublicOpportunity);
    return ok({ opportunities: publicOpportunities, count: publicOpportunities.length });
  });
}
