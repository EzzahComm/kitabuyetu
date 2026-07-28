import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { listGroupMembers } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** GET — active members of this group, for the member table on admin/groups/[id]. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id } = await params;
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await listGroupMembers(id, parsed.data);
    return ok(result);
  });
}
