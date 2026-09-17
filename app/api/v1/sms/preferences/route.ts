import { NextRequest } from 'next/server';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { withAuth } from '@/lib/auth/middleware';
import { withDb, type TenantContext } from '@/lib/db';
import { smsService } from '@/lib/services/sms.service';
import { ok } from '@/lib/utils/response';
import { NotFoundError } from '@/lib/utils/errors';

/**
 * Self-service SMS opt-out (SMS_MESSAGING_AUDIT_2026-08.md M5). smsService.
 * optOut/isOptedOut already existed and are honoured by every send path
 * (both notifications.service.ts's isPhoneOptedOut gate and sms.service.ts's
 * own fetchOptOuts) — the only gap was that nothing ever called optOut, so
 * members had no way to actually get their phone into the list. Scoped to
 * the caller's own phone and active group (sms_group_settings is per-group,
 * not global — a member in multiple groups sets this per group).
 *
 * Refactored (2026-09-16) from withAdminDb to withDb to enforce RLS on
 * member phone data. The query filters by memberId, which is verified by
 * auth.userId (caller can only read their own phone number).
 */

async function callerPhone(client: PoolClient, memberId: string): Promise<string> {
  const { rows } = await client.query<{ phone: string }>(
    `SELECT phone FROM members WHERE id = $1`,
    [memberId]
  );
  if (!rows[0]) throw new NotFoundError('Member', memberId);
  return rows[0].phone;
}

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx: TenantContext = {
      userId: auth.userId,
      groupId: auth.groupId,
      role: auth.role,
      organizationId: auth.organizationId,
    };

    return withDb(ctx, async (client) => {
      const phone = await callerPhone(client, auth.userId);
      const optedOut = await smsService.isOptedOut(auth.groupId, phone);
      return ok({ optedOut });
    });
  });
}

const PreferenceSchema = z.object({ optedOut: z.boolean() });

export async function PUT(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { optedOut } = PreferenceSchema.parse(await req.json());

    const ctx: TenantContext = {
      userId: auth.userId,
      groupId: auth.groupId,
      role: auth.role,
      organizationId: auth.organizationId,
    };

    return withDb(ctx, async (client) => {
      const phone = await callerPhone(client, auth.userId);

      if (optedOut) {
        await smsService.optOut(auth.groupId, phone);
      } else {
        await smsService.optIn(auth.groupId, phone);
      }

      return ok({ optedOut });
    });
  });
}
