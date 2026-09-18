import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { withAdminDb, type TenantContext } from '@/lib/db';
import { createPartner, listPartners } from '@/lib/services/ecosystem.service';

export const runtime = 'nodejs';

// GET /api/admin/ecosystem/partners — list all partners
export async function GET(request: NextRequest) {
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

    const partners = await listPartners(ctx);
    return NextResponse.json({ success: true, data: partners, count: partners.length });
  } catch (error) {
    console.error('Error fetching partners:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch partners' }, { status: 500 });
  }
}

// POST /api/admin/ecosystem/partners — create partner
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.is_platform_admin) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 403 });
    }

    const body = await request.json();
    const { name, type, description, logo_url, website_url, contact_email, contact_phone } = body;

    if (!name || !type) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
    }

    const ctx: TenantContext = {
      organizationId: session.user.organization_id,
      userId: session.user.id,
      ipAddress: request.ip,
    };

    const partner = await createPartner(ctx, {
      name,
      type,
      description,
      logo_url,
      website_url,
      contact_email,
      contact_phone,
    });

    return NextResponse.json({ success: true, data: partner }, { status: 201 });
  } catch (error) {
    console.error('Error creating partner:', error);
    return NextResponse.json({ success: false, error: 'Failed to create partner' }, { status: 500 });
  }
}
