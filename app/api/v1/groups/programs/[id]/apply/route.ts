export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withOneOf } from '@/lib/auth/middleware';
import { programApplicationsService } from '@/lib/services/program-applications.service';
import { SubmitProgramApplicationSchema } from '@/lib/validators/program.schema';
import { created } from '@/lib/utils/response';

/** POST /api/v1/groups/programs/:id/apply — chairperson applies the group to a published program */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  return withOneOf(req, ['chairperson'], async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const { id } = await params;
    const { applicationData } = SubmitProgramApplicationSchema.parse(await req.json().catch(() => ({})));
    return created(await programApplicationsService.submitApplication(ctx, id, applicationData));
  });
}
