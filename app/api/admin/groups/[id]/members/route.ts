import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, created, badRequest } from '@/lib/utils/response';
import { listGroupMembers, createGroupMember } from '@/lib/services/admin.service';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** GET — active members of this group, for the member table on admin/groups/[id]. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { id } = await params;
    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const result = await listGroupMembers(id, parsed.data);
    return ok(result);
  });
}

const createSchema = z.object({
  firstName: z.string().trim().min(2, 'Enter a first name'),
  lastName: z.string().trim().min(2, 'Enter a last name'),
  phone: z.string().trim().refine(isValidKenyanPhone, 'Enter a valid Kenyan phone number'),
  dateOfBirth: z.string().optional().or(z.literal('')),
  role: z.enum(['member', 'secretary', 'treasurer', 'chairperson']).optional(),
});

/**
 * POST — add a member on behalf of a group; super_admin only, same split as
 * the PATCH below (support is read-only across the admin surface). The one
 * add-member path reachable without signing in AS the group — see
 * createGroupMember's own comment for why this existed as a gap.
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const { dateOfBirth, ...rest } = parsed.data;
    const result = await createGroupMember(id, { ...rest, ...(dateOfBirth ? { dateOfBirth } : {}) }, auth.userId);
    return created(result);
  });
}
