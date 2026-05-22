import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listAuditLogs } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withRole(req, 'super_admin', async () => {
    const p  = new URL(req.url).searchParams;
    const data = await listAuditLogs({
      page:    parseInt(p.get('page')  ?? '1',  10),
      limit:   parseInt(p.get('limit') ?? '50', 10),
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
