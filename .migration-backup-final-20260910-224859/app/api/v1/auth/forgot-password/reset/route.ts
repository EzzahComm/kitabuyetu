export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { resetPasswordWithOtp } from '@/lib/services/password-reset.service';
import { ResetPasswordSchema } from '@/lib/validators/auth.schema';
import { ok, handleError } from '@/lib/utils/response';

/** POST /api/v1/auth/forgot-password/reset — public. Verifies the OTP and sets a new password in one step. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { phone, otp, password } = ResetPasswordSchema.parse(await req.json());
    await resetPasswordWithOtp(phone, otp, password);
    return ok({ status: 'reset' });
  } catch (err) {
    return handleError(err);
  }
}
