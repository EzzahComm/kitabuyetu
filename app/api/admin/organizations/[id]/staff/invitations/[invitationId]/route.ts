import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { cancelOrgInvitation } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

/** DELETE — cancel a pending invitation. */
export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; invitationId: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { invitationId } = await params;
    await cancelOrgInvitation(invitationId);
    return ok({ id: invitationId });
  });
}
