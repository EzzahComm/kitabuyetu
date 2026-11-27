import { NextRequest } from 'next/server';
import { z } from 'zod/v3';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { updateMemberProfile } from '@/lib/services/admin.service';
import { changeOrgStaffRole, removeOrgStaff } from '@/lib/services/organization-members.service';

export const dynamic = 'force-dynamic';

const patchSchema = z.union([
  z.object({ orgRole: z.enum(['lead', 'staff']) }).strict(),
  z
    .object({
      firstName: z.string().trim().min(1).max(100),
      lastName: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(254).toLowerCase().optional(),
      emailOwnershipConfirmed: z.literal(true).optional(),
    })
    .strict()
    .refine((input) => !input.email || input.emailOwnershipConfirmed, {
      message: 'Confirm ownership of the new sign-in email before saving.',
    }),
]);

/** PATCH — update the organization role or correct the existing staff account. */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id, memberId } = await params;
    if (!z.string().uuid().safeParse(id).success || !z.string().uuid().safeParse(memberId).success) {
      return badRequest('Invalid organization or staff identifier');
    }
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    if ('orgRole' in parsed.data) {
      await changeOrgStaffRole(id, memberId, parsed.data.orgRole);
    } else {
      const { firstName, lastName, email } = parsed.data;
      await updateMemberProfile(memberId, { firstName, lastName, email }, auth.userId, undefined, id);
    }
    return ok({ success: true });
  });
}

/** DELETE — remove (archive) a staff member from this organization. */
export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id, memberId } = await params;
    await removeOrgStaff(id, memberId, auth.userId);
    return ok({ success: true });
  });
}
