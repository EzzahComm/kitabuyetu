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
import { billingService } from '@/lib/services/billing.service';
import { accountingService } from '@/lib/services/accounting.service';
import type { LoginResponse } from '@/types/api.types';

const BCRYPT_ROUNDS    = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);
const REGISTRATION_FEE = parseInt(process.env.REGISTRATION_FEE_KES ?? '300', 10);

type Stage =
  | 'parse_body'
  | 'validate_input'
  | 'normalize_phone'
  | 'check_phone_unique'
  | 'insert_group'
  | 'hash_password'
  | 'insert_member'
  | 'link_group_member'
  | 'create_subscription'
  | 'seed_chart_of_accounts'
  | 'commit_transaction'
  | 'sign_tokens'
  | 'persist_refresh_token';

export async function POST(req: NextRequest): Promise<Response> {
  let stage: Stage = 'parse_body';
  try {
    const body = await req.json();

    stage = 'validate_input';
    const input = RegisterSchema.parse(body);

    stage = 'normalize_phone';
    const phone = normalizePhone(input.phone);
    const email = input.email && input.email !== '' ? input.email : null;

    // ── Atomic onboarding: group + member + membership link + billing + accounts.
    //    On any failure, withAdminDb rolls back the whole transaction.
    const txResult = await withAdminDb(async (client) => {
      stage = 'check_phone_unique';
      const { rows: existing } = await client.query<{ id: string }>(
        'SELECT id FROM members WHERE phone = $1', [phone],
      );
      if (existing[0]) return { duplicate: true as const };

      stage = 'insert_group';
      const { rows: groupRows } = await client.query<{ id: string }>(
        `INSERT INTO groups (name, "type", phone, email)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.groupName, input.groupType, phone, email],
      );
      const groupId = groupRows[0].id;

      stage = 'hash_password';
      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      stage = 'insert_member';
      const { rows: memberRows } = await client.query<{ id: string; platform_role: string }>(
        `INSERT INTO members (phone, email, password_hash, first_name, last_name)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, platform_role`,
        [phone, email, passwordHash, input.firstName, input.lastName],
      );
      const memberId     = memberRows[0].id;
      const platformRole = memberRows[0].platform_role;

      stage = 'link_group_member';
      await client.query(
        `INSERT INTO group_members (group_id, member_id, role) VALUES ($1,$2,$3)`,
        [groupId, memberId, 'group_admin'],
      );

      const ctx = { userId: memberId, groupId, role: 'group_admin' };

      stage = 'create_subscription';
      await billingService.createStarterSubscription(ctx, client);

      stage = 'seed_chart_of_accounts';
      await accountingService.seedDefaultAccountsInTx(client, groupId);

      return {
        duplicate:    false as const,
        memberId, groupId, platformRole,
        groupName:    input.groupName,
      };
    });

    stage = 'commit_transaction';
    if (txResult.duplicate) {
      return errorResponse('Phone number already registered', 'DUPLICATE_PHONE', 409);
    }

    const { memberId, groupId, groupName, platformRole } = txResult;

    stage = 'sign_tokens';
    const accessToken = signAccessToken({ sub: memberId, groupId, role: 'group_admin' as any });
    const { token: refreshToken } = signRefreshToken(memberId);

    stage = 'persist_refresh_token';
    try {
      await storeRefreshToken(hashToken(refreshToken), memberId, refreshTtlSeconds());
    } catch (redisErr) {
      // Non-fatal: user is registered. Access token is valid for 15 min;
      // refresh-token rotation will degrade until Redis is healthy again.
      logger.error('[register] failed to persist refresh token (non-fatal)', redisErr);
    }

    const response: LoginResponse & { registrationFee: number } = {
      accessToken,
      refreshToken,
      member: {
        id:           memberId,
        firstName:    input.firstName,
        lastName:     input.lastName,
        phone,
        email,
        platformRole: platformRole as any,
        groupRole:    'group_admin' as any,
        groupId,
        groupName,
      },
      registrationFee: REGISTRATION_FEE,
    };

    return created(response);
  } catch (err) {
    const e = err as { code?: string; message?: string; detail?: string; hint?: string; constraint?: string; stack?: string };

    // Full structured log for the operator — includes Postgres error metadata.
    logger.error('[register] failed', {
      stage,
      pg_code:    e?.code,
      message:    e?.message,
      detail:     e?.detail,
      hint:       e?.hint,
      constraint: e?.constraint,
      stack:      e?.stack,
    });

    // Preserve standard envelopes for known typed errors (validation, app errors, common PG codes).
    if (err instanceof ZodError || err instanceof AppError) return handleError(err);
    if (e?.code === '23505' || e?.code === '23503')         return handleError(err);

    // Unknown failure — surface the stage so the user (and support) knows which step broke.
    return errorResponse(
      `Registration failed at step '${stage}'. Please try again or contact support.`,
      `REG_FAIL_${stage}`,
      500,
    );
  }
}
