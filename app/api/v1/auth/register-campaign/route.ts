export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { RegisterCampaignSchema } from '@/lib/validators/campaign.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { created, handleError, errorResponse } from '@/lib/utils/response';
import { AppError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import { emitCampaignEvent } from '@/lib/notifications/emitters';
import { ActivityEventType } from '@/lib/notifications';

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);

type Stage = 'validate_input' | 'normalize_phone' | 'hash_password' | 'call_register_campaign_rpc' | 'emit_event';

interface RegisterCampaignResult {
  success: true;
  group_id: string;
  group_code: string;
  member_id: string;
  campaign_id: string;
  campaign_slug: string;
  account_code: string;
  status: string;
}

/**
 * POST /api/v1/auth/register-campaign - Changi$ha self-serve campaign creation.
 *
 * Same shape as register-organization's route: campaigns.group_id/created_by
 * are both NOT NULL at the DB level, so a public caller with no existing
 * Kitabu Yetu account needs a group + member created for them in the same
 * breath as the campaign - reached via register_campaign()'s SECURITY
 * DEFINER RPC (withAdminDb's privileged connection), not a broadened RLS
 * grant. The campaign is created already 'pending_review' - admin approval
 * (existing /admin/campaigns flow, unchanged) is still the gate before it is
 * public and donatable.
 *
 * Does NOT issue a session token - same reasoning as register-organization:
 * login is a separate flow, and this group starts unsubscribed (migration
 * 139, "every plan is paid"), same as any other new group. The creator can
 * check back once Kitabu Yetu staff review the submission; subscribing is
 * only needed to log into the dashboard afterward, not to get reviewed.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let stage: Stage = 'validate_input';
  try {
    const body = await req.json();
    const input = RegisterCampaignSchema.parse(body);

    stage = 'normalize_phone';
    const phone = normalizePhone(input.phone);
    const payoutPhone = input.payout.method === 'phone' ? normalizePhone(input.payout.phone) : undefined;

    stage = 'hash_password';
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    stage = 'call_register_campaign_rpc';
    const rpcPayload = {
      firstName: input.firstName,
      lastName: input.lastName,
      phone,
      passwordHash,
      title: input.title,
      story: input.story,
      targetAmount: input.targetAmount,
      beneficiaryName: input.beneficiaryName || '',
      beneficiaryConsentConfirmed: input.beneficiaryConsentConfirmed ?? false,
      coverImageUrl: input.coverImageUrl || '',
      endsAt: input.endsAt || '',
      payoutMethod: input.payout.method,
      payoutPhone: payoutPhone ?? '',
      payoutShortcode: input.payout.method !== 'phone' ? input.payout.shortcode : '',
      payoutAccount: input.payout.method === 'paybill' ? input.payout.account : '',
      payoutPayeeName: input.payout.method !== 'phone' ? input.payout.payeeName : '',
    };

    const result = await withAdminDb(async (client) => {
      const { rows } = await client.query<{ register_campaign: RegisterCampaignResult }>(
        'SELECT register_campaign($1::jsonb) AS register_campaign',
        [JSON.stringify(rpcPayload)],
      );
      return rows[0].register_campaign;
    });

    stage = 'emit_event';
    await emitCampaignEvent(result.campaign_id, ActivityEventType.CAMPAIGN_SUBMITTED, {
      actorUserId: result.member_id,
    });

    return created({
      groupCode: result.group_code,
      campaignSlug: result.campaign_slug,
      accountCode: result.account_code,
      status: result.status,
      // No tokens - see header. The creator signs in later, once they're
      // ready to pay for a subscription and manage the campaign.
      nextStep: 'awaiting_review',
    });
  } catch (err) {
    const e = err as {
      code?: string;
      message?: string;
      detail?: string;
      hint?: string;
      constraint?: string;
      stack?: string;
    };

    logger.error('[register-campaign] failed', {
      stage,
      pg_code: e?.code,
      message: e?.message,
      detail: e?.detail,
      hint: e?.hint,
      constraint: e?.constraint,
      stack: e?.stack,
    });

    if (err instanceof ZodError || err instanceof AppError) return handleError(err);

    if (e?.code === '23505') {
      if (e.constraint?.includes('phone')) {
        return errorResponse('Phone number already registered', 'DUPLICATE_PHONE', 409);
      }
      return handleError(err);
    }

    if (e?.code === '23503') return handleError(err);

    if (e?.code === '22023') {
      return errorResponse(e.message ?? 'Invalid input', 'INVALID_INPUT', 400);
    }

    return errorResponse(
      'Campaign registration failed. Please try again or contact support.',
      'CAMPAIGN_REGISTRATION_FAILED',
      500,
    );
  }
}
