export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { completeOrgInvitation } from '@/lib/services/organization-members.service';
import { ok, handleError } from '@/lib/utils/response';

const Schema = z.object({
  token:    z.string().min(32).max(128),
  password: z.string().min(8, 'Password must be at least 8 characters')
              .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
              .regex(/[0-9]/, 'Password must contain at least one number'),
});

/** POST /api/v1/organization-invitations/complete — public, final step: sets the password and creates the account. */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token, password } = Schema.parse(await req.json());
    await completeOrgInvitation(token, password);
    return ok({ status: 'completed' });
  } catch (err) {
    return handleError(err);
  }
}
