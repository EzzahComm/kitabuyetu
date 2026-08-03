export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { resetAdminPasswordWithToken } from '@/lib/services/admin-password-reset.service';
import { AdminResetPasswordSchema } from '@/lib/validators/auth.schema';
import { ok, handleError } from '@/lib/utils/response';

/** POST /api/v1/auth/admin/forgot-password/reset — public. Verifies the emailed token and sets a new password in one step. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token, password } = AdminResetPasswordSchema.parse(await req.json());
    await resetAdminPasswordWithToken(token, password);
    return ok({ status: 'reset' });
  } catch (err) {
    return handleError(err);
  }
}
