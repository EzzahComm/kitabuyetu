import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { listSupportTickets, createSupportTicket } from '@/lib/services/admin.service';
import { parsePagination } from '@/lib/utils/pagination';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withPlatformRole(req, ['super_admin', 'support'], async () => {
    const p = new URL(req.url).searchParams;
    const { page, limit } = parsePagination(p, { defaultLimit: 20 });
    const data = await listSupportTickets({
      page,
      limit,
      status: p.get('status') ?? undefined,
      priority: p.get('priority') ?? undefined,
      search: p.get('search') ?? undefined,
    });
    return ok(data);
  });
}

const createSchema = z.object({
  groupId: z.string().uuid().optional(),
  memberId: z.string().uuid().optional(),
  category: z.string().default('general'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  subject: z.string().min(5),
  description: z.string().min(10),
});

export function POST(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const ticket = await createSupportTicket(parsed.data);
    return ok(ticket, 201);
  });
}
