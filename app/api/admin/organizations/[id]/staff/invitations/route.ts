import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { listOrgInvitations } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

/** GET — every invitation ever sent for this organization, newest first. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { id } = await params;
    const invitations = await listOrgInvitations(id);
    return ok(invitations);
  });
}
