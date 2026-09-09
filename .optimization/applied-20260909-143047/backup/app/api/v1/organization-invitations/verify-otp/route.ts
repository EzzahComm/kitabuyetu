export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { verifyOrgInvitationOtp } from '@/lib/services/organization-members.service';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({
  token: z.string().min(32).max(128),
  otp:   z.string().length(6).regex(/^\d{6}$/, 'OTP must be 6 digits'),
});

/** POST /api/v1/organization-invitations/verify-otp — public. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token, otp } = Schema.parse(await req.json());
    await verifyOrgInvitationOtp(token, otp);
    return ok({ status: 'verified' });
  } catch (err) {
    return handleError(err);
  }
}
