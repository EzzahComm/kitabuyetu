import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest, handleError } from '@/lib/utils/response';
import { logger } from '@/lib/logger';
import { getC2BUrls, registerC2BUrls } from '@/lib/services/mpesa.service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ version: z.enum(['v1', 'v2']).optional() });

/**
 * GET/POST /api/admin/mpesa/register-c2b
 *
 * `registerC2BUrls()` (lib/services/daraja.service.ts) had zero call sites
 * anywhere in the app — the C2B Confirmation/Validation URLs were registered
 * with Safaricom by hand at some point, and nothing since has re-registered
 * or even displayed them. That gap is the prime suspect for a real paybill
 * receipt (UI3QZ4ZNVQ, 2026-09) never reaching the app: Safaricom has no
 * "what's currently registered" read API, so a stale or misconfigured
 * registration fails silently.
 *
 * GET returns the URLs this deployment WOULD register, computed but not
 * sent — safe to call anytime, no Daraja round trip. Lets an operator
 * confirm MPESA_CALLBACK_BASE_URL points at an unprotected host (not a
 * Vercel deployment-protected preview URL) without needing Vercel CLI
 * access to the Secret-typed env var.
 *
 * POST actually registers them with Safaricom and returns the response.
 * Super-admin only, same shape as governance/compute's on-demand trigger.
 */
export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(getC2BUrls());
  });
}

export function POST(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    try {
      const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
      if (!parsed.success) return badRequest(parsed.error.errors[0].message);

      const result = await registerC2BUrls(parsed.data.version);
      logger.info('[admin/mpesa/register-c2b] C2B URLs registered', {
        actorId: ctx.userId,
        ...result,
      });
      return ok(result);
    } catch (err) {
      logger.error('[admin/mpesa/register-c2b] Registration failed', err);
      return handleError(err);
    }
  });
}
