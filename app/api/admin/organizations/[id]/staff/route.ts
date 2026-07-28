import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { listOrgStaff, addOrgStaff } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

const addStaffSchema = z.object({
  phone:     z.string().min(1),
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  orgRole:   z.enum(['lead', 'staff']).default('staff'),
});

/** GET — list this organization's staff. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async () => {
    const { id } = await params;
    const staff  = await listOrgStaff(id);
    return ok(staff);
  });
}

/** POST — add a staff member to this organization. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id }  = await params;
    const body    = await req.json();
    const parsed  = addStaffSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await addOrgStaff(id, { ...parsed.data, invitedBy: auth.userId });
    return ok(result);
  });
}
