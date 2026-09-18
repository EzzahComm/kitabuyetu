import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { createOpportunity } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

// POST /api/admin/ecosystem/opportunities — create opportunity
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.is_platform_admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

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
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const ctx: TenantContext = {
      organizationId: session.user.organization_id,
      userId: session.user.id,
      ipAddress: request.ip,
    };

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

    return NextResponse.json({ success: true, data: opportunity }, { status: 201 });
  } catch (error) {
    console.error('Error creating opportunity:', error);
    return NextResponse.json({ success: false, error: 'Failed to create opportunity' }, { status: 500 });
  }
}
