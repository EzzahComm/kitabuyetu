export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { confirmOrgInvitationEmail } from '@/lib/services/organization-members.service';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({ token: z.string().min(32).max(128) });

/** Send the invitation email verification code. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token } = Schema.parse(await req.json());
    await confirmOrgInvitationEmail(token);
    return ok({ status: 'otp_sent' });
  } catch (err) {
    return handleError(err);
  }
}
