export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { startPasswordReset } from '@/lib/services/password-reset.service';
import { ForgotPasswordStartSchema } from '@/lib/validators/auth.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * POST /api/v1/auth/forgot-password/start — public. Always returns the same
 * generic success response, whether or not the phone belongs to an account.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { phone } = ForgotPasswordStartSchema.parse(await req.json());
    await startPasswordReset(phone);
    return ok({ status: 'sent' });
  } catch (err) {
    return handleError(err);
  }
}
