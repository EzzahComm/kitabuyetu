export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAdminDb } from '@/lib/db';
import { verifyRefreshToken, signAccessToken, hashToken } from '@/lib/auth/jwt';
import { getRefreshToken } from '@/lib/redis';
import { RefreshSchema } from '@/lib/validators/auth.schema';
import { ok, handleError, errorResponse } from '@/lib/utils/response';

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body  = await req.json();
    const input = RefreshSchema.parse(body);

    let payload;
    try {
      payload = verifyRefreshToken(input.refreshToken);
    } catch {
      return errorResponse('Invalid or expired refresh token', 'INVALID_TOKEN', 401);
    }

    const tokenHash = hashToken(input.refreshToken);
    const stored    = await getRefreshToken(tokenHash);
    if (!stored || stored !== payload.sub) {
      return errorResponse('Refresh token revoked or not found', 'TOKEN_REVOKED', 401);
    }

    // Re-fetch member's current group context
    const memberData = await withAdminDb(async (client) => {
      const { rows } = await client.query<{
        id: string; platform_role: string;
        group_id: string; role: string;
      }>(
        `SELECT m.id, m.platform_role, gm.group_id, gm.role
         FROM members m
         JOIN group_members gm ON gm.member_id = m.id AND gm.is_active = true
         WHERE m.id = $1
         ORDER BY gm.joined_at DESC
         LIMIT 1`,
        [payload.sub],
      );
      return rows[0] ?? null;
    });

    if (!memberData) {
      return errorResponse('Member not found', 'NOT_FOUND', 404);
    }

    const role = memberData.platform_role === 'super_admin' ? 'super_admin' : memberData.role;

    const accessToken = signAccessToken({
      sub:     memberData.id,
      groupId: memberData.group_id,
      role:    role as any,
    });

    return ok({ accessToken });
  } catch (err) {
    return handleError(err);
  }
}
