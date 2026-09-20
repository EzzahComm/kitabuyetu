export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { getEmployeeById, updateEmployee } from '@/lib/services/hr.service';
import { UpdateEmployeeSchema } from '@/lib/validators/hr.schema';
import { ok, notFound } from '@/lib/utils/response';

export function GET(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const employee = await getEmployeeById(params.id);
    if (!employee) return notFound('Employee not found');
    return ok(employee);
  });
}

export function PATCH(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = UpdateEmployeeSchema.parse(await req.json());
    const employee = await updateEmployee(ctx.userId, params.id, input);
    return ok(employee);
  });
}
