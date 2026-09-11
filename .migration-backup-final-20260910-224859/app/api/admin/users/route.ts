import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listPlatformUsers } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p  = new URL(req.url).searchParams;
    const data = await listPlatformUsers({
      page:   parseInt(p.get('page')  ?? '1',  10),
      limit:  parseInt(p.get('limit') ?? '25', 10),
      search: p.get('search') ?? undefined,
      role:   p.get('role')   ?? undefined,
    });
    return ok(data);
  });
}
