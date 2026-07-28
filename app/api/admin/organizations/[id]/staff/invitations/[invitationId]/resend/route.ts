import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok } from '@/lib/utils/response';
import { resendOrgInvitation } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

/** POST — regenerate the invite token and re-send the email. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string; invitationId: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { invitationId } = await params;
    const result = await resendOrgInvitation(invitationId);
    return ok(result);
  });
}
