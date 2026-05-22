import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { ok, badRequest } from '@/lib/utils/response';
import { listSupportTickets, createSupportTicket } from '@/lib/services/admin.service';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return withRole(req, 'super_admin', async () => {
    const p  = new URL(req.url).searchParams;
    const data = await listSupportTickets({
      page:     parseInt(p.get('page')  ?? '1',  10),
      limit:    parseInt(p.get('limit') ?? '20', 10),
      status:   p.get('status')   ?? undefined,
      priority: p.get('priority') ?? undefined,
      search:   p.get('search')   ?? undefined,
    });
    return ok(data);
  });
}

const createSchema = z.object({
  groupId:     z.string().uuid().optional(),
  memberId:    z.string().uuid().optional(),
  category:    z.string().default('general'),
  priority:    z.enum(['low','normal','high','urgent']).default('normal'),
  subject:     z.string().min(5),
  description: z.string().min(10),
});

export function POST(req: NextRequest) {
  return withRole(req, 'super_admin', async () => {
    const body   = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0].message);

    const ticket = await createSupportTicket(parsed.data);
    return ok(ticket, 201);
  });
}
