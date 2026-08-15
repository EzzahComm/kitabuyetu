import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, notFound, badRequest } from '@/lib/utils/response';
import { getAdminMemberDetail, updateMemberProfile } from '@/lib/services/admin.service';

export const dynamic = 'force-dynamic';

/** GET — cross-tenant member detail (SUPER_ADMIN_PLATFORM_AUDIT.md §2.6/§2.7 Phase 1). */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { memberId } = await params;
    const detail = await getAdminMemberDetail(memberId);
    if (!detail) return notFound('Member not found');
    return ok(detail);
  });
}

/**
 * Name and email only.
 *
 * PHONE IS DELIBERATELY NOT ACCEPTED HERE. It is the login identity and is
 * UNIQUE platform-wide, so editing it changes who can sign in to the account
 * — a different operation from correcting a typo, and one that needs its own
 * deliberate flow rather than riding along in a profile PATCH. The schema is
 * strict(), so a client that sends `phone` gets a clear 400 instead of having
 * it silently ignored.
 */
const profileSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters').max(100).optional(),
  lastName:  z.string().min(2, 'Last name must be at least 2 characters').max(100).optional(),
  email:     z.string().email('Invalid email address').nullable().optional().or(z.literal('')),
}).strict();

/** PATCH — super_admin only; `support` is read-only across the admin surface. */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; memberId: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id: groupId, memberId } = await params;
    const parsed = profileSchema.safeParse(await req.json());
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    // Throws ConflictError (409) on the members_email_unique collision and
    // NotFoundError (404) for an unknown member — both mapped by handleError.
    const result = await updateMemberProfile(memberId, parsed.data, auth.userId, groupId);
    return ok(result);
  });
}
