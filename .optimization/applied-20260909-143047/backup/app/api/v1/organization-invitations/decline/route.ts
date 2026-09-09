export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { declineOrgInvitationByToken } from '@/lib/services/organization-members.service';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({ token: z.string().min(32).max(128) });

/**
 * POST /api/v1/organization-invitations/decline — public. Lets the invitee
 * decline their own invitation (typo'd email, changed mind, "not me") at
 * any point before it's completed.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token } = Schema.parse(await req.json());
    await declineOrgInvitationByToken(token);
    return ok({ status: 'declined' });
  } catch (err) {
    return handleError(err);
  }
}
