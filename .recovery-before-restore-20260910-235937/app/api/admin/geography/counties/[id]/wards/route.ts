import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { getWardAggregation } from '@/lib/services/admin-geography.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { id } = await params;
    const data = await getWardAggregation(id);
    return ok(data);
  });
}
