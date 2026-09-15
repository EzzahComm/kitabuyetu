import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listPlatformUsers } from '@/lib/services/admin.service';
import { parsePagination } from '@/lib/utils/pagination';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p  = new URL(req.url).searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 25 });
    const data = await listPlatformUsers({
      page,
      limit,
      search: p.get('search') ?? undefined,
      role:   p.get('role')   ?? undefined,
    });
    return ok(data);
  });
}
