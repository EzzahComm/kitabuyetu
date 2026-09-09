export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withBackofficeAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { signBackofficeAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import { storeRefreshToken } from '@/lib/redis';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { AdminLoginResponse } from '@/types/api.types';
import type { AdminPlatformRole } from '@/lib/auth/middleware';

const Schema = z.object({ organizationId: z.string().uuid() });

interface TargetRow {
  first_name:    string;
  last_name:     string;
  email:         string | null;
  platform_role: string;
}

/**
 * POST /api/admin/auth/switch-org — mint a NEW backoffice session bound to
 * another organization the caller is active staff at (multi-staff
 * organizations, migration 101). Direct mirror of /api/v1/auth/switch-group's
 * design for the tenant side: no password re-entry — the existing verified
 * access token already proves identity, only the target membership is
 * validated, exactly like admin-login's own org resolution does.
 *
 * Lives under /api/admin/* (not /api/v1/*, unlike switch-group) because
 * proxy.ts buckets every /api/v1/* request as requiring a TENANT-audience
 * token — a backoffice token would be rejected before reaching this
 * handler. /api/admin/* is the correct bucket for anything requiring
 * aud: 'backoffice'.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withBackofficeAuth(req, async (auth) => {
    try {
      const input = Schema.parse(await req.json());
      if (input.organizationId === auth.organizationId) {
        return errorResponse('You are already in this organization', 'SAME_ORG', 400);
      }

      const target = await withAdminDb(async (client) => {
        const { rows } = await client.query<TargetRow>(
          `SELECT m.first_name, m.last_name, m.email, m.platform_role
           FROM organization_members om
           JOIN organizations o ON o.id = om.organization_id AND o.is_active = TRUE
           JOIN members m ON m.id = om.member_id AND m.is_active = TRUE
           WHERE om.member_id = $1 AND om.organization_id = $2 AND om.status = 'active'`,
          [auth.userId, input.organizationId],
        );
        return rows[0] ?? null;
      });

      if (!target) {
        return errorResponse('You have no active membership in that organization.', 'NO_ACTIVE_ORG', 403);
      }

      const accessToken = signBackofficeAccessToken({
        sub:          auth.userId,
        aud:          'backoffice',
        platformRole: target.platform_role as AdminPlatformRole,
        organizationId: input.organizationId,
      });
      const { token: refreshToken } = signRefreshToken(auth.userId, 'backoffice');
      const rtHash = hashToken(refreshToken);
      await storeRefreshToken(rtHash, auth.userId, refreshTtlSeconds('backoffice'));
      await withAdminDb((client) =>
        client.query(
          `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address)
           VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4)`,
          [auth.userId, rtHash, refreshTtlSeconds('backoffice'), req.headers.get('x-forwarded-for') ?? null],
        ),
      );

      const response: AdminLoginResponse = {
        accessToken,
        refreshToken,
        audience: 'backoffice',
        member: {
          id:           auth.userId,
          firstName:    target.first_name,
          lastName:     target.last_name,
          email:        target.email ?? '',
          platformRole: target.platform_role as AdminPlatformRole,
          organizationId: input.organizationId,
        },
      };
      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  });
}
