import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { withDb, type TenantContext } from '@/lib/db';
import { submitApplication } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { group_name, group_member_count, group_registration_number, contact_member_name, contact_member_phone, contact_member_email, message } = body;

    if (!group_name || !contact_member_name || !contact_member_phone) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 },
      );
    }

    // Get group ID from session context
    const ctx: TenantContext = {
      organizationId: session.user.organization_id,
      groupId: session.user.group_id,
      userId: session.user.id,
      ipAddress: request.ip,
    };

    const application = await submitApplication(ctx, params.id, ctx.groupId!, {
      group_name,
      group_member_count,
      group_registration_number,
      contact_member_name,
      contact_member_phone,
      contact_member_email,
      message,
    });

    return NextResponse.json({ success: true, data: application }, { status: 201 });
  } catch (error) {
    console.error('Error submitting application:', error);
    return NextResponse.json({ success: false, error: 'Failed to submit application' }, { status: 500 });
  }
}
