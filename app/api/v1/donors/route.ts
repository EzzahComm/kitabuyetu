import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import * as ecosystemService from '@/lib/services/ecosystem.service';
import { db } from '@/lib/db';

/**
 * GET /api/v1/donors
 * List public donors for organization (public or authed)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get('orgId');
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!orgId) {
    return NextResponse.json({ success: false, error: 'orgId required' }, { status: 422 });
  }

  const donors = await ecosystemService.listPublicDonors(orgId, { limit });

  if (donors.error) {
    return NextResponse.json({ success: false, error: donors.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    donors: donors.data,
    count: donors.data?.length || 0,
  });
}

/**
 * POST /api/v1/donors
 * Create/update donor profile (public or authed)
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { orgId, name, email, phone, isAnonymous, profileImageUrl, bio } = body;

  if (!orgId || !name) {
    return NextResponse.json(
      { success: false, error: 'orgId and name are required' },
      { status: 422 },
    );
  }

  const donor = await ecosystemService.createOrUpdateDonor(orgId, {
    name,
    email,
    phone,
    isAnonymous,
    profileImageUrl,
    bio,
  });

  if (donor.error) {
    return NextResponse.json({ success: false, error: donor.error.message }, { status: 500 });
  }

  return NextResponse.json(
    {
      success: true,
      donor: donor.data,
    },
    { status: 201 },
  );
}
