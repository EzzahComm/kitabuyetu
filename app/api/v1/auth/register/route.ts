export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { ZodError } from 'zod';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import { storeRefreshToken } from '@/lib/redis';
import { RegisterSchema } from '@/lib/validators/auth.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { created, handleError, errorResponse } from '@/lib/utils/response';
import { AppError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import type { LoginResponse } from '@/types/api.types';
import type { MemberRole, PlatformRole } from '@/types/enums';

const BCRYPT_ROUNDS    = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);
const REGISTRATION_FEE = parseInt(process.env.REGISTRATION_FEE_KES ?? '300', 10);

type Stage =
  | 'parse_body'
  | 'validate_input'
  | 'normalize_phone'
  | 'hash_password'
  | 'open_db_transaction'
  | 'call_register_group_rpc'
  | 'sign_tokens'
  | 'persist_refresh_token';

interface RegisterGroupResult {
  success:        true;
  group_id:       string;
  group_code:     string;
  group_name:     string;
  group_status:   string;     // Phase D Part 2 — always 'pending_verification' now
  member_id:      string;
  member_code:    string;
  person_id:      string;
  platform_role:  string;
  creator_role:   string;     // officer position chosen at signup
  group_role:     string;     // group_members.role derived from creator_role
                              // (chairperson→chairperson, secretary→secretary,
                              // treasurer→treasurer). All three can onboard
                              // members per ROLES.canManageMembers.
}

export async function POST(req: NextRequest): Promise<Response> {
  let stage: Stage = 'parse_body';
  try {
    const body = await req.json();

    stage = 'validate_input';
    const input = RegisterSchema.parse(body);

    stage = 'normalize_phone';
    const phone = normalizePhone(input.phone);
    const email = input.email && input.email !== '' ? input.email : null;

    stage = 'hash_password';
    const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

    // ── Single atomic RPC. Everything (group + person + member + officer +
    //    billing + chart of accounts) lives inside register_group(); on any
    //    failure the whole transaction rolls back.
    stage = 'open_db_transaction';
    const rpcPayload = {
      groupName:        input.groupName,
      groupType:        input.groupType,
      firstName:        input.firstName,
      lastName:         input.lastName,
      phone,
      email,
      passwordHash,
      creatorRole:      input.creatorRole,
      countyId:         input.countyId,
      subCountyText:    input.subCountyText ?? '',
      wardText:         input.wardText ?? '',
      villageEstate:    input.villageEstate ?? '',
      primaryObjective: input.primaryObjective ?? '',
      meetingFrequency: input.meetingFrequency ?? '',
      meetingDay:       input.meetingDay ?? '',
      meetingTime:      input.meetingTime ?? '',
      nationalId:       input.nationalId ?? '',
      dateOfBirth:      input.dateOfBirth ?? '',
      gender:           input.gender ?? '',
    };

    stage = 'call_register_group_rpc';
    const { result, membershipNo } = await withAdminDb(async (client) => {
      const { rows } = await client.query<{ register_group: RegisterGroupResult }>(
        'SELECT register_group($1::jsonb) AS register_group',
        [JSON.stringify(rpcPayload)],
      );
      const rpc = rows[0].register_group;
      // The Membership Number is allocated by the group_members INSERT trigger
      // (migration 056) inside the RPC; the RPC's JSONB result predates it.
      const { rows: gm } = await client.query<{ membership_no: string }>(
        `SELECT membership_no FROM group_members WHERE group_id = $1 AND member_id = $2`,
        [rpc.group_id, rpc.member_id],
      );
      return { result: rpc, membershipNo: gm[0]?.membership_no ?? null };
    });

    stage = 'sign_tokens';
    // role mirrors what the RPC actually wrote to group_members — derived from
    // creator_role so a treasurer / secretary gets their role-appropriate JWT
    // instead of being elevated to chairperson.
    const accessToken = signAccessToken({
      sub:         result.member_id,
      groupId:     result.group_id,
      role:        result.group_role as MemberRole,
      personId:    result.person_id,
      groupStatus: result.group_status,
    });
    // Pin the new group to the refresh token (audit C-1) — registration's
    // session must revalidate THIS membership on refresh, same as login.
    const { token: refreshToken } = signRefreshToken(result.member_id, 'tenant', result.group_id);

    stage = 'persist_refresh_token';
    try {
      const rtHash = hashToken(refreshToken);
      // The refresh_tokens TABLE is the rotation source of truth (§15.3) —
      // without this row the session's first refresh would be rejected.
      // Redis remains the fast revocation cache.
      await withAdminDb((client) =>
        client.query(
          `INSERT INTO refresh_tokens (member_id, token_hash, expires_at, ip_address, lineage_id, membership_id)
           VALUES ($1, $2, NOW() + make_interval(secs => $3::int), $4, gen_random_uuid(),
                   (SELECT gm.id FROM group_members gm
                    WHERE gm.group_id = $5 AND gm.member_id = $1))`,
          [result.member_id, rtHash, refreshTtlSeconds(),
           req.headers.get('x-forwarded-for') ?? null, result.group_id],
        ),
      );
      await storeRefreshToken(rtHash, result.member_id, refreshTtlSeconds());
    } catch (redisErr) {
      // Non-fatal: user is registered. Access token works for 15 min.
      logger.error('[register] failed to persist refresh token (non-fatal)', redisErr);
    }

    const response: LoginResponse & {
      registrationFee: number;
      groupCode:       string;
      memberCode:      string;
      membershipNo?:   string;
      groupStatus:     string;
    } = {
      accessToken,
      refreshToken,
      member: {
        id:           result.member_id,
        firstName:    input.firstName,
        lastName:     input.lastName,
        phone,
        email,
        platformRole: result.platform_role as PlatformRole,
        groupRole:    result.group_role as MemberRole,
        groupId:      result.group_id,
        groupName:    result.group_name,
        groupCode:    result.group_code,
        memberCode:   result.member_code,
        membershipNo: membershipNo ?? undefined,
        personId:     result.person_id,
        officerRole:  result.creator_role,
        groupStatus:  result.group_status,
      },
      registrationFee: REGISTRATION_FEE,
      groupCode:       result.group_code,
      memberCode:      result.member_code,
      membershipNo:    membershipNo ?? undefined,
      groupStatus:     result.group_status,
    };

    return created(response);
  } catch (err) {
    const e = err as { code?: string; message?: string; detail?: string; hint?: string; constraint?: string; stack?: string };

    logger.error('[register] failed', {
      stage,
      pg_code:    e?.code,
      message:    e?.message,
      detail:     e?.detail,
      hint:       e?.hint,
      constraint: e?.constraint,
      stack:      e?.stack,
    });

    // Known typed errors → standard envelopes
    if (err instanceof ZodError || err instanceof AppError) return handleError(err);

    // PG unique violation: most likely duplicate phone (members.phone is UNIQUE).
    // Tell the user precisely.
    if (e?.code === '23505') {
      if (e.constraint?.includes('phone')) {
        return errorResponse('Phone number already registered', 'DUPLICATE_PHONE', 409);
      }
      if (e.constraint?.includes('group_code')) {
        return errorResponse('Group code collision — please retry', 'GROUP_CODE_COLLISION', 500);
      }
      return handleError(err);
    }

    // PG FK violation (e.g. invalid county_id)
    if (e?.code === '23503') return handleError(err);

    // RPC-raised invalid-input errors (SQLSTATE 22023)
    if (e?.code === '22023') {
      return errorResponse(e.message ?? 'Invalid input', 'INVALID_INPUT', 400);
    }

    // Unknown failure. The stage + full PG error detail are already in the
    // server-side log above (OPTIMIZATION_CLEANUP_AUDIT.md Medium #22) — the
    // client response stays generic rather than exposing internal pipeline
    // step names.
    return errorResponse(
      'Registration failed. Please try again or contact support.',
      'REGISTRATION_FAILED',
      500,
    );
  }
}
