export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { terminateEmployee } from '@/lib/services/hr.service';
import { TerminateEmployeeSchema } from '@/lib/validators/hr.schema';
import { ok } from '@/lib/utils/response';

export function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = TerminateEmployeeSchema.parse(await req.json());
    const employee = await terminateEmployee(ctx.userId, params.id, input);
    return ok(employee);
  });
}
