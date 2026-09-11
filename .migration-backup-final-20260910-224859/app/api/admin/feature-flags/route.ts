import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { listFeatureFlags, toggleFeatureFlag } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const flags = await listFeatureFlags();
    return ok(flags);
  });
}

const toggleSchema = z.object({
  key:     z.string().min(1),
  enabled: z.boolean(),
});

export function PATCH(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const body   = await req.json();
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await toggleFeatureFlag(parsed.data.key, parsed.data.enabled, auth.userId);
    return ok(result);
  });
}
