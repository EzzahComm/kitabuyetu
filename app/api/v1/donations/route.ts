import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import * as ecosystemService from '@/lib/services/ecosystem.service';
import { db } from '@/lib/db';
import { checkRateLimit } from '@/lib/redis';

const DONATION_RATE_LIMIT = 10; // 10 donations per hour per phone/IP
const DONATION_MAX_AMOUNT = 500000; // KES 500K max per donation

/**
 * GET /api/v1/donations
 * List donations for campaign/program (org only or public if public=true)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const programId = searchParams.get('programId');
  const campaignId = searchParams.get('campaignId');
  const isPublic = searchParams.get('public') === 'true';

  if (!programId && !campaignId) {
    return NextResponse.json(
      { success: false, error: 'programId or campaignId required' },
      { status: 422 },
    );
  }

  let query = db.from('donations').select('*').eq('status', 'completed');

  if (programId) {
    query = query.eq('program_id', programId);
  } else {
    query = query.eq('campaign_id', campaignId);
  }

  if (isPublic) {
    query = query.eq('is_public', true);
  }

  const donations = await query.order('created_at', { ascending: false }).limit(50);

  if (donations.error) {
    return NextResponse.json({ success: false, error: donations.error.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    donations: donations.data,
    count: donations.data?.length || 0,
  });
}

/**
 * POST /api/v1/donations
 * Record donation (public endpoint - rate limited)
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const clientIp = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const { orgId, campaignId, programId, amount, donorPhone, donorName, donorEmail, donorMessage, isAnonymous } = body;

  // Validation
  if (!orgId || (!campaignId && !programId)) {
    return NextResponse.json(
      { success: false, error: 'orgId and campaignId or programId required' },
      { status: 422 },
    );
  }

  if (!amount || amount <= 0 || amount > DONATION_MAX_AMOUNT) {
    return NextResponse.json(
      { success: false, error: `amount must be between 1 and ${DONATION_MAX_AMOUNT}` },
      { status: 422 },
    );
  }

  // Rate limit by phone + IP
  const rateLimitKey = `donation:${donorPhone || clientIp}`;
  const isAllowed = await checkRateLimit(rateLimitKey, DONATION_RATE_LIMIT, 3600);

  if (!isAllowed) {
    return NextResponse.json(
      { success: false, error: 'Too many donation attempts. Please try again later.' },
      { status: 429 },
    );
  }

  // Create/update donor if phone provided
  let donorId: string | undefined;
  if (donorPhone) {
    const donor = await ecosystemService.createOrUpdateDonor(orgId, {
      name: donorName || 'Anonymous Donor',
      phone: donorPhone,
      email: donorEmail,
      isAnonymous: isAnonymous ?? false,
    });

    if (!donor.error) {
      donorId = donor.data?.id;
    }
  }

  // Record donation
  const donation = await ecosystemService.recordDonation(orgId, {
    donorId,
    campaignId,
    programId,
    amount: parseFloat(amount),
    donorName: isAnonymous ? undefined : donorName,
    donorEmail: donorEmail,
    donorMessage,
    donorPhone: donorPhone,
    isPublic: !isAnonymous,
  });

  if (donation.error) {
    return NextResponse.json({ success: false, error: donation.error.message }, { status: 500 });
  }

  // Update program progress if applicable
  if (programId) {
    await ecosystemService.updateProgramProgress(programId, parseFloat(amount));
  }

  return NextResponse.json(
    {
      success: true,
      donation: donation.data,
    },
    { status: 201 },
  );
}
