export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import { storeRefreshToken } from '@/lib/redis';
import { CreateAdditionalGroupSchema } from '@/lib/validators/auth.schema';
import { created, handleError, errorResponse } from '@/lib/utils/response';
import { AppError, NotFoundError } from '@/lib/utils/errors';
import { logger } from '@/lib/logger';
import type { LoginResponse } from '@/types/api.types';
import type { MemberRole, PlatformRole, SubscriptionProduct } from '@/types/enums';

interface CreateAdditionalGroupResult {
  success:        true;
  group_id:       string;
  group_code:     string;
  group_name:     string;
  group_status:   string;
  member_id:      string;
  member_code:    string;
  person_id:      string;
  platform_role:  string;
  creator_role:   string;
  group_role:     string;
  signup_product: SubscriptionProduct;
  first_name:     string;
  last_name:      string;
  phone:          string;
  email:          string | null;
}

/**
 * POST /api/v1/auth/create-group — let an ALREADY-authenticated member found
 * an additional group under their existing identity, instead of the
 * public/anonymous /register form, which always creates a brand-new
 * members/person row and would 409 on this caller's own phone (see migration
 * 147's own header for the full story).
 *
 * No password re-entry: the verified access token proves identity, and a new
 * session is minted for the freshly-created membership exactly like
 * /api/v1/auth/switch-group already does for an EXISTING one — same trust
 * model, same token-issuance shape.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const input = CreateAdditionalGroupSchema.parse(await req.json());

      const rpcPayload = {
        groupName:        input.groupName,
        groupType:        input.groupType,
        creatorRole:      input.creatorRole,
        countyId:         input.countyId,
        subCountyText:    input.subCountyText ?? '',
        wardText:         input.wardText ?? '',
        villageEstate:    input.villageEstate ?? '',
        primaryObjective: input.primaryObjective ?? '',
        meetingFrequency: input.meetingFrequency ?? '',
        meetingDay:       input.meetingDay ?? '',
        meetingTime:      input.meetingTime ?? '',
        product:          input.product,
      };

      const result = await withAdminDb(async (client) => {
        const { rows } = await client.query<{ create_additional_group: CreateAdditionalGroupResult }>(
          'SELECT create_additional_group($1::uuid, $2::jsonb) AS create_additional_group',
          [auth.userId, JSON.stringify(rpcPayload)],
        );
        return rows[0].create_additional_group;
      });

      // New session for the freshly-created membership — same shape as
      // switch-group's, so the client's existing `login(data)` handler works
      // unchanged. The previous session (in whichever group the caller came
      // from) is left untouched, same independent-lineage model.
      const accessToken = signAccessToken({
        sub:         result.member_id,
        groupId:     result.group_id,
        role:        result.group_role as MemberRole,
        personId:    result.person_id,
        groupStatus: result.group_status,
      });
      const { token: refreshToken } = signRefreshToken(result.member_id, 'tenant', result.group_id);

      try {
        const rtHash = hashToken(refreshToken);
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
        // Non-fatal, matches register/route.ts's own precedent: the group is
        // created either way. Access token works for 15 min.
        logger.error('[create-group] failed to persist refresh token (non-fatal)', redisErr);
      }

      const response: LoginResponse & {
        groupCode:     string;
        memberCode:    string;
        groupStatus:   string;
        signupProduct: SubscriptionProduct;
      } = {
        accessToken,
        refreshToken,
        member: {
          id:           result.member_id,
          firstName:    result.first_name,
          lastName:     result.last_name,
          phone:        result.phone,
          email:        result.email,
          platformRole: result.platform_role as PlatformRole,
          groupRole:    result.group_role as MemberRole,
          groupId:      result.group_id,
          groupName:    result.group_name,
          groupCode:    result.group_code,
          memberCode:   result.member_code,
          personId:     result.person_id,
          officerRole:  result.creator_role,
          groupStatus:  result.group_status,
        },
        groupCode:     result.group_code,
        memberCode:    result.member_code,
        groupStatus:   result.group_status,
        signupProduct: result.signup_product,
      };

      return created(response);
    } catch (err) {
      const e = err as { code?: string; message?: string; constraint?: string };

      logger.error('[create-group] failed', {
        memberId: auth.userId, pg_code: e?.code, message: e?.message, constraint: e?.constraint,
      });

      if (err instanceof AppError) return handleError(err);

      // The RPC's own not-found guard (defensive — p_member_id always comes
      // from a verified JWT, so this should never actually fire in practice).
      if (e?.code === 'P0002') return handleError(new NotFoundError('Active membership'));

      // RPC-raised invalid-input errors (SQLSTATE 22023) — same convention
      // register/route.ts uses.
      if (e?.code === '22023') {
        return errorResponse(e.message ?? 'Invalid input', 'INVALID_INPUT', 400);
      }

      // A group-name collision (uq_group_name_per_county) or any other
      // unique violation falls through to handleError's generic 23505
      // mapping — perfectly adequate here, and register/route.ts's own
      // catch leaves the equivalent case (it only special-cases the phone
      // and group_code constraints) to the same fallback.
      return handleError(err);
    }
  });
}
