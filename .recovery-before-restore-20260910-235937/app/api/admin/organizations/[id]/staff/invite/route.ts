import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { createOrgInvitation } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

const inviteSchema = z.object({
  email:     z.string().email(),
  phone:     z.string().min(1),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  orgRole:   z.enum(['lead', 'staff']).default('staff'),
});

/** POST — invite a new staff member by email (Phase 2, two-channel verification). */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id }  = await params;
    const body    = await req.json();
    const parsed  = inviteSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await createOrgInvitation(id, { ...parsed.data, invitedBy: auth.userId });
    return ok(result);
  });
}
