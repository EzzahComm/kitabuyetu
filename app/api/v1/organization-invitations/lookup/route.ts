export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getOrgInvitation } from '@/lib/services/organization-members.service';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({ token: z.string().min(32).max(128) });

/**
 * POST /api/v1/organization-invitations/lookup — public, read-only. Lets the
 * accept-invite page display who invited the visitor before any state
 * changes, same pattern as /auth/verify/email's public token-in-body design.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token } = Schema.parse(await req.json());
    const invitation = await getOrgInvitation(token);
    return ok(invitation);
  } catch (err) {
    return handleError(err);
  }
}
