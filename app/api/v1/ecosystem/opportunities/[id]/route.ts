import { NextRequest, NextResponse } from 'next/server';
import { withDb } from '@/lib/db';
import { getOpportunityById, evaluateEligibility } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    return withDb(null, async (db) => {
      const opportunity = await getOpportunityById(db, params.id);
      if (!opportunity) return NextResponse.json({ success: false, error: 'Opportunity not found' }, { status: 404 });

      return NextResponse.json({ success: true, data: opportunity });
    });
  } catch (error) {
    console.error('Error fetching opportunity:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch opportunity' }, { status: 500 });
  }
}
