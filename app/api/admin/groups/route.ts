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
      // Whitelisted rather than passed through: this lands in the LATERAL's
      // enum comparison, and an unknown string would fail the query outright
      // instead of degrading to the default view. Migration 127.
      product: p.get('product') === 'chama_reminder' ? 'chama_reminder' : 'kitabu_yetu',
    });
    return ok(data);
  });
}
