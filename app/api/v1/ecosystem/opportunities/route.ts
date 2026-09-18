import { NextRequest, NextResponse } from 'next/server';
import { withDb } from '@/lib/db';
import { listPublishedOpportunities } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const category = searchParams.get('category');
    const featured = searchParams.get('featured') === 'true';

    return withDb(null, async (db) => {
      const opportunities = await listPublishedOpportunities(db, {
        type: type || undefined,
        category: category || undefined,
        featured_only: featured,
      });

      return NextResponse.json({
        success: true,
        data: opportunities,
        count: opportunities.length,
      });
    });
  } catch (error) {
    console.error('Error fetching opportunities:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch opportunities' }, { status: 500 });
  }
}
