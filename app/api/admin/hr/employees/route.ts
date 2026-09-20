export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { createEmployee, listEmployees, type EmploymentStatus } from '@/lib/services/hr.service';
import { CreateEmployeeSchema } from '@/lib/validators/hr.schema';
import { ok, created } from '@/lib/utils/response';

export function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    const params = req.nextUrl.searchParams;
    const employees = await listEmployees({
      status: (params.get('status') as EmploymentStatus | null) ?? undefined,
      department: params.get('department') ?? undefined,
      search: params.get('search') ?? undefined,
    });
    return ok(employees);
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const input = CreateEmployeeSchema.parse(await req.json());
    const employee = await createEmployee(ctx.userId, input);
    return created(employee);
  });
}
