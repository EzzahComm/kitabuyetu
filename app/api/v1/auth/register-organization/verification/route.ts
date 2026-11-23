import type { NextRequest } from 'next/server';
import { readOrganizationSignupJson, sendOrganizationSignupCode } from '@/lib/auth/organization-signup';
import { OrganizationSignupEmailSchema } from '@/lib/validators/auth.schema';
import { handleError, ok } from '@/lib/utils/response';

export async function POST(request: NextRequest): Promise<Response> {
  try {
    const { email } = OrganizationSignupEmailSchema.parse(await readOrganizationSignupJson(request));
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    await sendOrganizationSignupCode(email, ip);
    return ok({ sent: true });
  } catch (error) {
    return handleError(error);
  }
}
