export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { completeGroupVerificationByToken } from '@/lib/services/group-verification.service';
import { ok, handleError, errorResponse } from '@/lib/utils/response';

const Schema = z.object({ token: z.string().min(32).max(128) });

const LINK_ERROR_COPY: Record<string, string> = {
  LINK_INVALID: 'This verification link is invalid or has already been used.',
  LINK_EXPIRED: 'This verification link has expired. Please request a new one.',
};

/**
 * POST /api/v1/auth/verify/email — public email-link completion (§4A). The
 * token itself is the proof of possession (it's a 32-byte random value whose
 * SHA-256 hash alone identifies the open verification row), so this route
 * intentionally takes no Authorization header — someone clicking the link
 * from their email client may not have the app's session on that device.
 * proxy.ts's PUBLIC_AUTH_PATHS bypasses JWT verification for this exact path.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const { token } = Schema.parse(await req.json());
    const { groupId } = await completeGroupVerificationByToken(token);
    return ok({ status: 'active', groupId });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e?.code === '22023') {
      const msg = e.message ?? '';
      return errorResponse(LINK_ERROR_COPY[msg] ?? msg ?? 'Verification failed', msg || 'VERIFICATION_FAILED', 400);
    }
    return handleError(err);
  }
}
