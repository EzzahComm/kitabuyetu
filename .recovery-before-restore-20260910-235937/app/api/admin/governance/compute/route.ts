import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { computeGovernanceForAllGroups } from '@/lib/services/governance.service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ asOf: z.string().date().optional() });

/**
 * POST — manually trigger a governance computation run, instead of waiting
 * for the monthly scheduled job (1st of month, 11:00 UTC). Same function
 * the job handler calls; this is the on-demand path for both admin use
 * ("recompute now") and verifying the engine works without waiting a month.
 */
export function POST(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const asOf = parsed.data.asOf ?? new Date().toISOString().slice(0, 10);
    const result = await computeGovernanceForAllGroups(asOf);
    return ok(result);
  });
}
