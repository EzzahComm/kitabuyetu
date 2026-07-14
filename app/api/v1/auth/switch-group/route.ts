export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import { storeRefreshToken } from '@/lib/redis';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { LoginResponse } from '@/types/api.types';

const Schema = z.object({ groupId: z.string().uuid() });

interface TargetRow {
  membership_id: string;
  group_id:      string;
  member_code:   string;
  membership_no: string;
  person_id:     string;
  group_role:    string;
  auth_version:  number;
  group_code:    string;
  group_name:    string;
  group_status:  string;
  officer_role:  string | null;
  first_name:    string;
  last_name:     string;
  phone:         string;
  email:         string | null;
  platform_role: string;
  session_version: number;
}

/**
 * POST /api/v1/auth/switch-group — mint a NEW session bound to another of the
 * member's active memberships (payment architecture §8, ADR-11).
 *
 * Sessions are independent lineages: this issues a fresh access + refresh
 * token pair (new lineage) for the target membership and leaves the current
 * session untouched — no revoke-on-switch; revocation is for logout and
 * security events. No password re-entry: the verified access token proves
 * identity; the target membership is validated exactly like login.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const input = Schema.parse(await req.json());
      if (input.groupId === auth.groupId) {
        return errorResponse('You are already in this group', 'SAME_GROUP', 400);
      }

      const target = await withAdminDb(async (client) => {
        const { rows } = await client.query<TargetRow>(
          `SELECT gm.id AS membership_id, gm.group_id, gm.member_code,
                  gm.membership_no, gm.person_id,
                  gm.role AS group_role, gm.auth_version,
                  g.group_code, g.name AS group_name, g.status AS group_status,
                  go.role AS officer_role,
                  m.first_name, m.last_name, m.phone, m.email,
                  m.platform_role, m.session_version
           FROM   group_members gm
           JOIN   groups  g ON g.id = gm.group_id
                            AND g.status NOT IN ('suspended','archived')
           JOIN   members m ON m.id = gm.member_id AND m.is_active = true
           LEFT JOIN group_officers go
             ON go.group_id = gm.group_id AND go.member_id = gm.member_id
            AND go.removed_at IS NULL
           WHERE  gm.member_id = $1 AND gm.group_id = $2 AND gm.status = 'active'`,
          [auth.userId, input.groupId],
        );
        return rows[0] ?? null;
      });

      if (!target) {
        return errorResponse(
          'You have no active membership in that group.',
          'NO_ACTIVE_GROUP',
          403,
        );
      }

      const effectiveRole = target.platform_role === 'super_admin'
        ? 'super_admin'
        : target.group_role;

      const accessToken = signAccessToken({
        sub:            auth.userId,
        groupId:        target.group_id,
        role:           effectiveRole as never,
        personId:       target.person_id,
        groupStatus:    target.group_status,
        membershipId:   target.membership_id,
        membershipNo:   target.membership_no,
        authVersion:    target.auth_version,
        sessionVersion: target.session_version,
      });

      const { token: refreshToken } = signRefreshToken(
        auth.userId, 'tenant', target.group_id, target.session_version,
      );
      const rtHash = hashToken(refreshToken);
      await withAdminDb((client) =>
        client.query(
          `INSERT INTO refresh_tokens
             (member_id, token_hash, expires_at, ip_address, lineage_id, membership_id)
           VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4, gen_random_uuid(), $5)`,
          [auth.userId, rtHash, refreshTtlSeconds(),
           req.headers.get('x-forwarded-for') ?? null, target.membership_id],
        ),
      );
      await storeRefreshToken(rtHash, auth.userId, refreshTtlSeconds()).catch(() => {});

      const response: LoginResponse = {
        accessToken,
        refreshToken,
        member: {
          id:           auth.userId,
          firstName:    target.first_name,
          lastName:     target.last_name,
          phone:        target.phone,
          email:        target.email,
          platformRole: target.platform_role as never,
          groupRole:    target.group_role as never,
          groupId:      target.group_id,
          groupName:    target.group_name,
          groupCode:    target.group_code,
          memberCode:   target.member_code,
          membershipNo: target.membership_no,
          personId:     target.person_id,
          officerRole:  target.officer_role ?? undefined,
          groupStatus:  target.group_status,
        },
      };
      return ok(response);
    } catch (err) {
      return handleError(err);
    }
  });
}
