export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { startAdminPasswordReset } from '@/lib/services/admin-password-reset.service';
import { AdminForgotPasswordStartSchema } from '@/lib/validators/auth.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * POST /api/v1/auth/admin/forgot-password/start — public. Always returns the
 * same generic success response, whether or not the email belongs to a
 * staff (super_admin/support/organization_coordinator) account.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { email } = AdminForgotPasswordStartSchema.parse(await req.json());
    await startAdminPasswordReset(email);
    return ok({ status: 'sent' });
  } catch (err) {
    return handleError(err);
  }
}
