import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { searchPlatform } from '@/lib/services/admin-search.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const q = new URL(req.url).searchParams.get('q')?.trim() ?? '';
    if (q.length < 2) return badRequest('q must be at least 2 characters');
    const data = await searchPlatform(q);
    return ok(data);
  });
}
