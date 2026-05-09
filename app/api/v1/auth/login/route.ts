export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { pool, withAdminDb } from '@/lib/db';
import { signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import { storeRefreshToken, incrementLoginAttempts, clearLoginAttempts, isAccountLocked, lockAccount, getLoginAttempts } from '@/lib/redis';
import { LoginSchema } from '@/lib/validators/auth.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { ok, handleError, errorResponse } from '@/lib/utils/response';
import type { LoginResponse } from '@/types/api.types';

const MAX_ATTEMPTS      = parseInt(process.env.MAX_LOGIN_ATTEMPTS     ?? '5',  10);
const LOCKOUT_MINUTES   = parseInt(process.env.LOGIN_LOCKOUT_MINUTES  ?? '15', 10);

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = await req.json();
    const input = LoginSchema.parse(body);
    const phone = normalizePhone(input.phone);

    // Account lockout check
    if (await isAccountLocked(phone)) {
      return errorResponse(
        `Too many failed attempts. Account locked for ${LOCKOUT_MINUTES} minutes.`,
        'ACCOUNT_LOCKED',
        429,
      );
    }

    const result = await withAdminDb(async (client) => {
      const { rows: members } = await client.query<{
        id: string; password_hash: string; first_name: string; last_name: string;
        email: string | null; platform_role: string; is_active: boolean;
      }>(
        `SELECT id, password_hash, first_name, last_name, email, platform_role, is_active
         FROM members WHERE phone = $1`,
        [phone],
      );

      const member = members[0];
      if (!member || !member.is_active) return null;

      const passwordOk = await bcrypt.compare(input.password, member.password_hash);
      if (!passwordOk) return null;

      // Fetch group membership
      const { rows: gm } = await client.query<{ role: string; group_name: string }>(
        `SELECT gm.role, g.name AS group_name
         FROM group_members gm
         JOIN groups g ON g.id = gm.group_id
         WHERE gm.group_id = $1 AND gm.member_id = $2 AND gm.is_active = true`,
        [input.groupId, member.id],
      );

      if (!gm[0]) return null;

      // Update last_login_at
      await client.query('UPDATE members SET last_login_at = NOW() WHERE id = $1', [member.id]);

      return { member, groupRole: gm[0].role, groupName: gm[0].group_name };
    });

    if (!result) {
      const attempts = await incrementLoginAttempts(phone);
      if (attempts >= MAX_ATTEMPTS) {
        await lockAccount(phone, LOCKOUT_MINUTES);
      }
      return errorResponse('Invalid credentials', 'INVALID_CREDENTIALS', 401);
    }

    await clearLoginAttempts(phone);

    const { member, groupRole, groupName } = result;
    const role = member.platform_role === 'super_admin' ? 'super_admin' : groupRole;

    const accessToken = signAccessToken({
      sub:     member.id,
      groupId: input.groupId,
      role:    role as any,
    });

    const { token: refreshToken } = signRefreshToken(member.id);
    const rtHash = hashToken(refreshToken);
    await storeRefreshToken(rtHash, member.id, refreshTtlSeconds());

    // Persist the same SHA-256 hash used by Redis so logout can revoke both atomically.
    await withAdminDb(async (client) => {
      await client.query(
        `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address)
         VALUES ($1,$2,NOW() + $3::interval * INTERVAL '1 second',$4)`,
        [member.id, rtHash, refreshTtlSeconds(), req.headers.get('x-forwarded-for') ?? null],
      );
    });

    const response: LoginResponse = {
      accessToken,
      refreshToken,
      member: {
        id:           member.id,
        firstName:    member.first_name,
        lastName:     member.last_name,
        phone,
        email:        member.email,
        platformRole: member.platform_role as any,
        groupRole:    groupRole as any,
        groupId:      input.groupId,
        groupName,
      },
    };

    return ok(response);
  } catch (err) {
    return handleError(err);
  }
}
