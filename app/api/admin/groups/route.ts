import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listGroups } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const p    = new URL(req.url).searchParams;
    const data = await listGroups({
      page:   parseInt(p.get('page')  ?? '1',  10),
      limit:  parseInt(p.get('limit') ?? '20', 10),
      search: p.get('search') ?? undefined,
      status: p.get('status') ?? undefined,
      plan:   p.get('plan')   ?? undefined,
    });
    return ok(data);
  });
}
