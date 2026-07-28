import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, notFound } from '@/lib/utils/response';
import { getAdminMemberDetail } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

/** GET — cross-tenant member detail (SUPER_ADMIN_PLATFORM_AUDIT.md §2.6/§2.7 Phase 1). */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { memberId } = await params;
    const detail = await getAdminMemberDetail(memberId);
    if (!detail) return notFound('Member not found');
    return ok(detail);
  });
}
