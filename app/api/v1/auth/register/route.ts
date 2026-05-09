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

      // Verify the group exists
      const { rows: group } = await client.query<{ id: string; name: string }>(
        'SELECT id, name FROM groups WHERE id = $1 AND is_active = true', [input.groupId],
      );
      if (!group[0]) {
        return { error: 'Group not found', code: 'GROUP_NOT_FOUND' };
      }

      const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

      const { rows: memberRows } = await client.query<{ id: string }>(
        `INSERT INTO members (phone, email, password_hash, first_name, last_name)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [phone, input.email ?? null, passwordHash, input.firstName, input.lastName],
      );
      const memberId = memberRows[0].id;

      // Add to group as admin (first member = group_admin, others = member)
      const { rows: existingMembers } = await client.query<{ count: string }>(
        'SELECT COUNT(*) AS count FROM group_members WHERE group_id = $1', [input.groupId],
      );
      const role = parseInt(existingMembers[0].count, 10) === 0 ? 'group_admin' : 'member';

      await client.query(
        `INSERT INTO group_members (group_id, member_id, role) VALUES ($1,$2,$3)`,
        [input.groupId, memberId, role],
      );

      return { memberId, groupName: group[0].name, role };
    });

    if ('error' in result) {
      return errorResponse(result.error ?? 'Registration failed', result.code ?? 'REG_ERROR', 409);
    }

    const { memberId, groupName, role } = result;

    // Provision Starter subscription + chart of accounts for new groups
    const ctx: TenantContext = { userId: memberId, groupId: input.groupId, role };
    await withAdminDb(async (client) => {
      await billingService.createStarterSubscription(ctx, client);
    });
    await accountingService.seedDefaultAccounts(ctx);

    const accessToken = signAccessToken({ sub: memberId, groupId: input.groupId, role: role as any });
    const { token: refreshToken } = signRefreshToken(memberId);
    await storeRefreshToken(hashToken(refreshToken), memberId, refreshTtlSeconds());

    return created({
      accessToken,
      refreshToken,
      member: { id: memberId, firstName: input.firstName, lastName: input.lastName, phone, groupId: input.groupId, groupName, role },
      registrationFee: REGISTRATION_FEE,
    });
  } catch (err) {
    return handleError(err);
  }
}
