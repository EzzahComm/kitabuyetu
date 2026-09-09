import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { changeOrgStaffRole, removeOrgStaff } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

const changeRoleSchema = z.object({
  orgRole: z.enum(['lead', 'staff']),
});

/** PATCH — change a staff member's role within this organization. */
export function PATCH(
  req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id, memberId } = await params;
    const body   = await req.json();
    const parsed = changeRoleSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    await changeOrgStaffRole(id, memberId, parsed.data.orgRole);
    return ok({ success: true });
  });
}

/** DELETE — remove (archive) a staff member from this organization. */
export function DELETE(
  req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id, memberId } = await params;
    await removeOrgStaff(id, memberId, auth.userId);
    return ok({ success: true });
  });
}
