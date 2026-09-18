export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { listPublishedOpportunities } from '@/lib/services/ecosystem.service';
import { ok } from '@/lib/utils/response';

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

    return ok({ opportunities, count: opportunities.length });
  });
}
