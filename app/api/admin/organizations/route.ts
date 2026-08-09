import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, created, badRequest } from '@/lib/utils/response';
import {
  listOrganizations, createOrganization, ORGANIZATION_TYPES,
} from '@/lib/services/admin-organizations.service';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p    = new URL(req.url).searchParams;
    const data = await listOrganizations({
      page:   parseInt(p.get('page')  ?? '1',  10),
      limit:  parseInt(p.get('limit') ?? '20', 10),
      search: p.get('search') ?? undefined,
      type:   p.get('type')   ?? undefined,
      status: p.get('status') ?? undefined,
    });
    return ok(data);
  });
}

const createSchema = z.object({
  name:               z.string().min(2).max(255),
  type:               z.enum(ORGANIZATION_TYPES),
  registrationNumber: z.string().max(100).optional(),
  phone:              z.string().max(20).optional(),
  email:              z.string().email().max(255).optional().or(z.literal('')),
  county:             z.string().max(100).optional(),
  address:            z.string().max(500).optional(),
});

export function POST(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const body   = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const org = await createOrganization({
      ...parsed.data,
      email: parsed.data.email || undefined,
    });
    return created(org);
  });
}
