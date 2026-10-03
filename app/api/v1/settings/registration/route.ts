export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withOneOf } from '@/lib/auth/middleware';
import { groupRegistrationService } from '@/lib/services/group-registration.service';
import { SetGroupRegistrationSchema } from '@/lib/validators/group.schema';
import { ok, handleError } from '@/lib/utils/response';

/**
 * GET /api/v1/settings/registration - this group's government-registration
 *   status (flag, number, certificate signed URL). Any authenticated member
 *   can read.
 * PUT /api/v1/settings/registration - set whether the group is registered and
 *   its registration number. Chairperson only: that is who the database lets
 *   update the group record (the `groups_update` RLS policy), so allowing
 *   another officer here would only turn a clear 403 into a confusing failure
 *   after the fact.
 *
 * Optional and non-blocking: a group onboards and subscribes fine without ever
 * touching this. The details can also be given at sign-up, which writes them
 * without going through this route.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await groupRegistrationService.get(ctx));
    } catch (err) {
      return handleError(err);
    }
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withOneOf(req, ['chairperson'], async (auth) => {
    try {
      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const input = SetGroupRegistrationSchema.parse(await req.json());
      return ok(
        await groupRegistrationService.setStatus(ctx, {
          isGovernmentRegistered: input.isGovernmentRegistered,
          registrationNumber: input.registrationNumber ?? null,
        }),
      );
    } catch (err) {
      return handleError(err);
    }
  });
}
