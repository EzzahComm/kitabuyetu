export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { completeGroupVerificationAuthed } from '@/lib/services/group-verification.service';
import {
  signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds,
} from '@/lib/auth/jwt';
import { storeRefreshToken } from '@/lib/redis';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { LoginResponse } from '@/types/api.types';

const Schema = z.object({ code: z.string().min(4).max(10) });

interface MembershipRow {
  membership_id:   string;
  group_role:      string;
  auth_version:    number;
  membership_no:   string;
  member_code:     string;
  person_id:       string;
  session_version: number;
  group_code:      string;
  group_name:      string;
  first_name:      string;
  last_name:       string;
  phone:           string;
  email:           string | null;
  platform_role:   string;
  officer_role:    string | null;
}

const OTP_ERROR_COPY: Record<string, string> = {
  OTP_INVALID:           'Incorrect code. Please try again.',
  OTP_EXPIRED:           'This code has expired. Request a new one.',
  OTP_TOO_MANY_ATTEMPTS: 'Too many incorrect attempts. Request a new code.',
};

/**
 * POST /api/v1/auth/verify/complete — the SMS-OTP completion path (§4A).
 * The current access token still carries the stale `groupStatus:
 * 'pending_verification'` claim after this succeeds, so — same as
 * switch-group — this mints a fresh token pair rather than relying on the
 * client to re-login.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const { code } = Schema.parse(await req.json());
      await completeGroupVerificationAuthed(auth.groupId, code);

      const row = await withAdminDb(async (client) => {
        const { rows } = await client.query<MembershipRow>(
          `SELECT gm.id AS membership_id, gm.role AS group_role, gm.auth_version,
                  gm.membership_no, gm.member_code, gm.person_id,
                  g.group_code, g.name AS group_name,
                  m.first_name, m.last_name, m.phone, m.email,
                  m.platform_role, m.session_version,
                  go.role AS officer_role
             FROM group_members gm
             JOIN groups  g  ON g.id = gm.group_id
             JOIN members m  ON m.id = gm.member_id
             LEFT JOIN group_officers go
               ON go.group_id = gm.group_id AND go.member_id = gm.member_id AND go.removed_at IS NULL
            WHERE gm.member_id = $1 AND gm.group_id = $2`,
          [auth.userId, auth.groupId],
        );
        return rows[0];
      });

      const effectiveRole = row.platform_role === 'super_admin' ? 'super_admin' : row.group_role;

      const accessToken = signAccessToken({
        sub:            auth.userId,
        groupId:        auth.groupId,
        role:           effectiveRole as never,
        personId:       row.person_id,
        groupStatus:    'active',
        membershipId:   row.membership_id,
        membershipNo:   row.membership_no,
        authVersion:    row.auth_version,
        sessionVersion: row.session_version,
      });
      const { token: refreshToken } = signRefreshToken(
        auth.userId, 'tenant', auth.groupId, row.session_version,
      );
      const rtHash = hashToken(refreshToken);
      await withAdminDb((client) =>
        client.query(
          `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address, lineage_id, membership_id)
           VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4, gen_random_uuid(), $5)`,
          [auth.userId, rtHash, refreshTtlSeconds(),
           req.headers.get('x-forwarded-for') ?? null, row.membership_id],
        ),
      );
      await storeRefreshToken(rtHash, auth.userId, refreshTtlSeconds()).catch(() => {});

      const response: LoginResponse = {
        accessToken,
        refreshToken,
        member: {
          id:           auth.userId,
          firstName:    row.first_name,
          lastName:     row.last_name,
          phone:        row.phone,
          email:        row.email,
          platformRole: row.platform_role as never,
          groupRole:    row.group_role as never,
          groupId:      auth.groupId,
          groupName:    row.group_name,
          groupCode:    row.group_code,
          memberCode:   row.member_code,
          membershipNo: row.membership_no,
          personId:     row.person_id,
          officerRole:  row.officer_role ?? undefined,
          groupStatus:  'active',
        },
      };
      return ok(response);
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === '22023') {
        const msg = e.message ?? '';
        return errorResponse(OTP_ERROR_COPY[msg] ?? msg ?? 'Verification failed', msg || 'VERIFICATION_FAILED', 400);
      }
      return handleError(err);
    }
  });
}
