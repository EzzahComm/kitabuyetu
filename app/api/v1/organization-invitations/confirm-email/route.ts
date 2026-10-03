export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { confirmOrgInvitationEmail } from '@/lib/services/organization-members.service';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({ token: z.string().min(32).max(128) });

/**
 * POST /api/v1/organization-invitations/confirm-email — public. Marks the
 * emailed link as used (proves inbox control) and sends the SMS OTP that
 * proves phone control — the second, distinct channel.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token } = Schema.parse(await req.json());
    const { phone } = await confirmOrgInvitationEmail(token);
    return ok({ phone });
  } catch (err) {
    return handleError(err);
  }
}
