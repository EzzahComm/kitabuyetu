export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOneOf } from '@/lib/auth/middleware';
import { groupRegistrationService } from '@/lib/services/group-registration.service';
import { checkCertificate } from '@/lib/utils/signup-request';
import { badRequest, ok, handleError } from '@/lib/utils/response';

/**
 * POST /api/v1/settings/registration/certificate — multipart/form-data with a
 * `certificate` PDF field (up to 4 MB: Vercel rejects bigger bodies before they
 * reach us). Chairperson only, matching who the database lets update the group
 * record. Uploading implies the group is registered — the flag flips to true
 * even if a registration number was never separately entered.
 *
 * This is for adding or replacing the certificate AFTER the group is up and
 * subscribed. At sign-up the certificate travels with the sign-up request itself
 * (see lib/utils/signup-request.ts), because a brand-new group cannot reach this
 * route yet.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withOneOf(req, ['chairperson'], async (auth) => {
    try {
      const formData = await req.formData();
      const field = formData.get('certificate');
      const file = field instanceof File ? field : null;
      if (!file || file.size === 0) {
        return badRequest('Attach the certificate as a PDF under the "certificate" field');
      }

      const { certificate, rejected } = await checkCertificate(file);
      if (!certificate) return badRequest(rejected ?? 'The certificate must be a PDF.');

      const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      return ok(await groupRegistrationService.setCertificate(ctx, certificate));
    } catch (err) {
      return handleError(err);
    }
  });
}
