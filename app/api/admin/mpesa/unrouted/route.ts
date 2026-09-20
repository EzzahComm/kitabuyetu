import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listUnroutedPayments } from '@/lib/services/admin.service';
import { parsePagination } from '@/lib/utils/pagination';

export const dynamic = 'force-dynamic';

/**
 * List unrouted M-Pesa payments, platform-wide. Read-only, so support can see
 * the queue — the same "support is read-only" split as every other admin
 * list — resolving one is super_admin only (see [id]/route.ts).
 */
export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p    = new URL(req.url).searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 20 });
    const data = await listUnroutedPayments({
      page,
      limit,
      search: p.get('search') ?? undefined,
    });
    return ok(data);
  });
}
