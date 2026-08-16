import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest, notFound } from '@/lib/utils/response';
import { getGroupById, updateGroupStatus, updateGroupProfile } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const { id } = await params;
    const group = await getGroupById(id);
    if (!group) return notFound('Group not found');
    return ok(group);
  });
}

const actionSchema = z.object({
  action: z.enum(['approve', 'suspend', 'activate', 'deactivate']),
  reason: z.string().optional(),
});

/**
 * Profile corrections. A SEPARATE schema from the status action rather than
 * another member of that union: a lifecycle transition and a typo fix are
 * different operations with different risk, and overloading `action` would
 * make it easy to send both and be unclear which won.
 */
const profileSchema = z.object({
  name:             z.string().min(3, 'Group name must be at least 3 characters').max(255).optional(),
  // Must match the group_type Postgres enum EXACTLY. It previously listed
  // 'organization_group', which is not a member of that enum — saving it
  // would have thrown 22P02 and surfaced as a 500 — while omitting the real
  // value 'ngo_group', so NGO groups could not be retyped at all. Nothing hit
  // it because no UI ever called this endpoint.
  type:             z.enum(['chama', 'sacco', 'welfare', 'investment', 'ngo_group']).optional(),
  countyId:         z.string().uuid().nullable().optional(),
  subCounty:        z.string().max(80).nullable().optional(),
  ward:             z.string().max(100).nullable().optional(),
  villageEstate:    z.string().max(200).nullable().optional(),
  primaryObjective: z.enum([
    'savings', 'table_banking', 'welfare', 'women_empowerment', 'youth_development',
    'agriculture', 'business_investment', 'housing', 'education', 'health',
    'community_development', 'other',
  ]).nullable().optional(),
  meetingFrequency: z.enum(['weekly', 'biweekly', 'monthly']).nullable().optional(),
  meetingDay:       z.enum(['monday','tuesday','wednesday','thursday','friday','saturday','sunday']).nullable().optional(),
  meetingTime:      z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be HH:MM').nullable().optional(),
});

/**
 * PATCH — either a status transition (`{ action }`) or a profile correction.
 *
 * super_admin only, not `support`: support is read-only across the admin
 * surface by an existing decision, and this edits real group and member data.
 */
export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withPlatformRole(req, 'super_admin', async (auth) => {
    const { id } = await params;
    const body   = await req.json();

    if (body && typeof body === 'object' && 'action' in body) {
      const parsed = actionSchema.safeParse(body);
      if (!parsed.success) return badRequest(parsed.error.errors[0].message);
      const result = await updateGroupStatus(id, parsed.data.action, auth.userId, parsed.data.reason);
      return ok(result);
    }

    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);
    // Throws ConflictError (409) on uq_group_name_per_county collision and
    // NotFoundError (404) for an unknown group — both mapped by handleError.
    const result = await updateGroupProfile(id, parsed.data, auth.userId);
    return ok(result);
  });
}
