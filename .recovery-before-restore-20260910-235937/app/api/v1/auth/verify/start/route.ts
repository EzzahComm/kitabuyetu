export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { startGroupVerification } from '@/lib/services/group-verification.service';
import { ok, handleError, errorResponse } from '@/lib/utils/response';

const Schema = z.object({ channel: z.enum(['email', 'sms']) });

interface GroupMemberRow {
  group_status: string;
  group_name:   string;
  group_code:   string;
  email:        string | null;
  phone:        string;
  first_name:   string;
  last_name:    string;
}

/**
 * POST /api/v1/auth/verify/start — begins (or restarts) group verification
 * for the signed-in member's own group (§4A). Reachable while the group is
 * still pending_verification (proxy.ts's allowedPending list) since that's
 * the whole point of this route.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const { channel } = Schema.parse(await req.json());

      const row = await withAdminDb(async (client) => {
        const { rows } = await client.query<GroupMemberRow>(
          `SELECT g.status AS group_status, g.name AS group_name, g.group_code,
                  m.email, m.phone, m.first_name, m.last_name
             FROM groups g
             JOIN members m ON m.id = $1
            WHERE g.id = $2`,
          [auth.userId, auth.groupId],
        );
        return rows[0] ?? null;
      });

      if (!row) return errorResponse('Group not found', 'NOT_FOUND', 404);
      if (row.group_status !== 'pending_verification') {
        return errorResponse('This group is already verified.', 'ALREADY_VERIFIED', 400);
      }

      const { expiresAt } = await startGroupVerification(
        {
          groupId:    auth.groupId,
          groupName:  row.group_name,
          groupCode:  row.group_code,
          memberName: `${row.first_name} ${row.last_name}`,
          email:      row.email,
          phone:      row.phone,
        },
        channel,
      );

      return ok({ channel, expiresAt });
    } catch (err) {
      const e = err as { code?: string; message?: string };
      if (e?.code === '22023') return errorResponse(e.message ?? 'Invalid request', 'INVALID_INPUT', 400);
      return handleError(err);
    }
  });
}
