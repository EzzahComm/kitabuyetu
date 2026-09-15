import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listAuditLogs } from '@/lib/services/admin.service';
import { parsePagination } from '@/lib/utils/pagination';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p  = new URL(req.url).searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 50 });
    const data = await listAuditLogs({
      page,
      limit,
      groupId: p.get('groupId') ?? undefined,
      action:  p.get('action')  ?? undefined,
      table:   p.get('table')   ?? undefined,
      search:  p.get('search')  ?? undefined,
      from:    p.get('from')    ?? undefined,
      to:      p.get('to')      ?? undefined,
    });
    return ok(data);
  });
}
