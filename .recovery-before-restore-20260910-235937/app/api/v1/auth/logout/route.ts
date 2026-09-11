export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { revokeRefreshToken } from '@/lib/redis';
import { hashToken, verifyRefreshToken } from '@/lib/auth/jwt';
import { withAdminDb } from '@/lib/db';
import { ok, handleError } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json().catch(() => ({}));
    const refreshToken = body?.refreshToken as string | undefined;

    if (refreshToken) {
      try {
        verifyRefreshToken(refreshToken);
        const hash = hashToken(refreshToken);
        // Revoke in both Redis and DB using the same SHA-256 hash stored at login.
        await revokeRefreshToken(hash);
        await withAdminDb(async (client) => {
          await client.query(
            'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1',
            [hash],
          );
        });
      } catch {
        // Ignore invalid tokens on logout — client clears storage regardless
      }
    }

    return ok({ message: 'Logged out successfully' });
  } catch (err) {
    return handleError(err);
  }
}
