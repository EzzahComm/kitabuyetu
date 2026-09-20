export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { hireApplicant } from '@/lib/services/careers.service';
import { HireApplicantSchema } from '@/lib/validators/careers.schema';
import { ok } from '@/lib/utils/response';

export function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = HireApplicantSchema.parse(await req.json());
    const result = await hireApplicant(ctx.userId, params.id, input);
    return ok(result);
  });
}
