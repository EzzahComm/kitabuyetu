export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { withAdminDb } from '@/lib/db';
import { signAccessToken, signRefreshToken, hashToken, refreshTtlSeconds } from '@/lib/auth/jwt';
import { storeRefreshToken } from '@/lib/redis';
import { RegisterSchema } from '@/lib/validators/auth.schema';
import { normalizePhone } from '@/lib/utils/phone';
import { created, handleError, errorResponse } from '@/lib/utils/response';
import { billingService } from '@/lib/services/billing.service';
import { accountingService } from '@/lib/services/accounting.service';
import type { TenantContext } from '@/lib/db';

const BCRYPT_ROUNDS      = parseInt(process.env.BCRYPT_ROUNDS ?? '10', 10);
const REGISTRATION_FEE   = parseInt(process.env.REGISTRATION_FEE_KES ?? '300', 10);

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body  = await req.json();
    const input = RegisterSchema.parse(body);
    const phone = normalizePhone(input.phone);

    const result = await withAdminDb(async (client) => {
      // Check phone uniqueness
      const { rows: existing } = await client.query<{ id: string }>(
        'SELECT id FROM members WHERE phone = $1', [phone],
      );
      if (existing[0]) {
        return { error: 'Phone number already registered', code: 'DUPLICATE_PHONE' };
      }

      const email = input.email === '' ? null : input.email ?? null;

      const { rows: groupRows } = await client.query<{ id: string }>(
        `INSERT INTO groups (name, "type", phone, email)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [input.groupName, input.groupType, phone, email],
      );
      const groupId = groupRows[0].id;

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      const { rows: memberRows } = await client.query<{ id: string }>(
        `INSERT INTO members (phone, email, password_hash, first_name, last_name)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [phone, email, passwordHash, input.firstName, input.lastName],
      );
      const memberId = memberRows[0].id;

      await client.query(
        `INSERT INTO group_members (group_id, member_id, role) VALUES ($1,$2,$3)`,
        [groupId, memberId, 'group_admin'],
      );

      return { memberId, groupId, groupName: input.groupName, role: 'group_admin' };
    });

    if ('error' in result) {
      return errorResponse(result.error ?? 'Registration failed', result.code ?? 'REG_ERROR', 409);
    }

    const { memberId, groupId, groupName, role } = result;

    // Provision Starter subscription + chart of accounts for new groups
    const ctx: TenantContext = { userId: memberId, groupId, role };
    await withAdminDb(async (client) => {
      await billingService.createStarterSubscription(ctx, client);
    });
    await accountingService.seedDefaultAccounts(ctx);

    const accessToken = signAccessToken({ sub: memberId, groupId, role: role as any });
    const { token: refreshToken } = signRefreshToken(memberId);
    await storeRefreshToken(hashToken(refreshToken), memberId, refreshTtlSeconds());

    return created({
      accessToken,
      refreshToken,
      member: { id: memberId, firstName: input.firstName, lastName: input.lastName, phone, groupId, groupName, role },
      registrationFee: REGISTRATION_FEE,
    });
  } catch (err) {
    return handleError(err);
  }
}
