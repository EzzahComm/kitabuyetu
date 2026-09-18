import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { type TenantContext } from '@/lib/db';
import { publishOpportunity } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.is_platform_admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    const ctx: TenantContext = {
      organizationId: session.user.organization_id,
      userId: session.user.id,
      ipAddress: request.ip,
    };

    const opportunity = await publishOpportunity(ctx, params.id);
    return NextResponse.json({ success: true, data: opportunity });
  } catch (error) {
    console.error('Error publishing opportunity:', error);
    return NextResponse.json({ success: false, error: 'Failed to publish opportunity' }, { status: 500 });
  }
}
