export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { submitApplication } from '@/lib/services/careers.service';
import { SubmitApplicationSchema } from '@/lib/validators/careers.schema';
import { created, badRequest, handleError } from '@/lib/utils/response';

const MAX_RESUME_BYTES = 5 * 1024 * 1024; // 5MB, same cap as the CSV import route
const ALLOWED_RESUME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * POST /api/v1/careers/apply — public. multipart/form-data with jobSlug,
 * jobTitle, applicantName, applicantEmail, applicantPhone?, coverNote?, and
 * an optional `resume` file field. Whitelisted in proxy.ts's
 * PUBLIC_AUTH_PATHS and IP-rate-limited there like every other anonymous
 * surface.
 */
export async function POST(req: NextRequest): Promise<Response> {
  try {
    const formData = await req.formData();
    const input = SubmitApplicationSchema.parse({
      jobSlug: formData.get('jobSlug'),
      jobTitle: formData.get('jobTitle'),
      applicantName: formData.get('applicantName'),
      applicantEmail: formData.get('applicantEmail'),
      applicantPhone: formData.get('applicantPhone') || undefined,
      coverNote: formData.get('coverNote') || undefined,
    });

    const file = formData.get('resume') as File | null;
    let resume: { buffer: Buffer; contentType: string; filename: string } | undefined;
    if (file && file.size > 0) {
      if (file.size > MAX_RESUME_BYTES) {
        return badRequest(`Resume too large: ${(file.size / 1024 / 1024).toFixed(1)}MB exceeds 5MB cap`);
      }
      if (!ALLOWED_RESUME_TYPES.has(file.type)) {
        return badRequest('Resume must be a PDF or Word document');
      }
      resume = { buffer: Buffer.from(await file.arrayBuffer()), contentType: file.type, filename: file.name };
    }

    const application = await submitApplication(input, resume);
    return created({ id: application.id, status: 'submitted' });
  } catch (err) {
    return handleError(err);
  }
}
