import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { type TenantContext } from '@/lib/db';
import { updateApplicationStatus } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user?.is_platform_admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { status, response_message } = body;

    if (!status || !['submitted', 'shortlisted', 'accepted', 'rejected', 'withdrawn'].includes(status)) {
      return NextResponse.json({ success: false, error: 'Invalid status' }, { status: 400 });
    }

    const ctx: TenantContext = {
      organizationId: session.user.organization_id,
      userId: session.user.id,
      ipAddress: request.ip,
    };

    const application = await updateApplicationStatus(ctx, params.id, status, response_message);
    return NextResponse.json({ success: true, data: application });
  } catch (error) {
    console.error('Error updating application status:', error);
    return NextResponse.json({ success: false, error: 'Failed to update application' }, { status: 500 });
  }
}
