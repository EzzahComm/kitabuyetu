export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { campaignsService } from '@/lib/services/campaigns.service';
import { initiateSTKPush } from '@/lib/services/mpesa-stk.service';
import { DonateSchema } from '@/lib/validators/campaign.schema';
import { checkRateLimit } from '@/lib/redis';
import { ok, badRequest, notFound, handleError } from '@/lib/utils/response';

/**
 * POST /api/v1/campaigns/[slug]/donate — the ONE public, unauthenticated
 * endpoint on this platform that can trigger a real M-Pesa STK push (see
 * migration 182's header on why every other money-in path requires an
 * existing member). Rate-limited by phone AND by IP — generous enough for a
 * real supporter, tight enough to block a script hammering the paybill —
 * same `checkRateLimit` (fail-open on Redis loss) already used by
 * app/api/v1/daraja/[token]/c2b-validate for the same reason.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await params;
    const parsed = DonateSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);
    const input = parsed.data;

    const callerIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0';
    const [byPhone, byIp] = await Promise.all([
      checkRateLimit(`campaign_donate:phone:${input.phone}`, 5, 300),
      checkRateLimit(`campaign_donate:ip:${callerIp}`, 20, 300),
    ]);
    if (!byPhone || !byIp) {
      return NextResponse.json(
        { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' },
        { status: 429 },
      );
    }

    const campaign = await campaignsService.getPublicCampaignBySlug(slug);
    if (!campaign) return notFound('Campaign not found or not currently accepting donations');

    const result = await initiateSTKPush({
      phone:            input.phone,
      amount:           input.amount,
      accountReference: campaign.slug,
      description:      campaign.title,
      groupId:          campaign.group_id,
      purpose:          'campaign_donation',
      campaignId:       campaign.id,
      donorName:        input.donorName,
      donorMessage:     input.message,
      isAnonymous:      input.isAnonymous,
    });

    return ok({
      checkoutRequestId: result.checkoutRequestId,
      message: 'Check your phone to complete the donation.',
    });
  } catch (err) {
    return handleError(err);
  }
}
