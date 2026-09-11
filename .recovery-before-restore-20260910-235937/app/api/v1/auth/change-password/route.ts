export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { membersService } from '@/lib/services/members.service';
import { ChangePasswordSchema } from '@/lib/validators/auth.schema';
import { ok } from '@/lib/utils/response';

/**
 * POST /api/v1/auth/change-password — change the signed-in member's own
 * password.
 *
 * Closes a real gap rather than adding a feature: the settings page has always
 * had this form, but it posted to PATCH /members/[id], whose schema and column
 * whitelist both ignore password fields — so the request succeeded, nothing
 * changed, and the UI reported success anyway
 * (CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md). `membersService.changePassword`
 * already did the bcrypt compare + rehash; it had no caller.
 *
 * Always acts on `auth.userId` — the member id is never taken from the body,
 * so this route cannot be used to set someone else's password.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const input = ChangePasswordSchema.parse(await req.json());
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    await membersService.changePassword(
      ctx, auth.userId, input.currentPassword, input.newPassword,
    );

    // A password change should not leave older sessions alive. The caller's
    // current access token stays valid until it expires (it is not stored
    // server-side and cannot be revoked individually); every refresh token for
    // this member is revoked, so no other session can renew itself.
    await withAdminDb(async (client) => {
      await client.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE member_id = $1 AND revoked_at IS NULL`,
        [auth.userId],
      );
    });

    return ok({ changed: true });
  });
}
