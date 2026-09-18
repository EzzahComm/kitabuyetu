export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { getOpportunityById } from '@/lib/services/ecosystem.service';
import { ok, notFound } from '@/lib/utils/response';

export async function GET(request: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withAdminDb(async (db) => {
    const opportunity = await getOpportunityById(db, params.id);
    if (!opportunity) return notFound('Opportunity not found');
    return ok(opportunity);
  });
}
