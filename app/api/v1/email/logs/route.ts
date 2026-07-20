import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';

const QuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  status:   z.string().optional(),
  category: z.string().optional(),
  days:     z.coerce.number().int().min(1).default(30),
});

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { page, limit, status, category, days } = QuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const offset = (page - 1) * limit;

    const conditions: string[] = [`created_at >= NOW() - ($1 || ' days')::interval`];
    const params: unknown[]    = [days];

    if (auth.role !== 'super_admin') {
      params.push(auth.groupId);
      conditions.push(`group_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const where = conditions.map((c) => `(${c})`).join(' AND ');

    const [{ rows }, { rows: countRows }] = await Promise.all([
      withAdminDb((db) =>
        db.query(
          `SELECT id, "to", "from", subject, template_key, category, provider, status,
                  provider_message_id, sent_at, opened_at, bounced_at, error_message,
                  reference_type, reference_id, created_at
           FROM email_logs
           WHERE ${where}
           ORDER BY created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
      ),
      withAdminDb((db) =>
        db.query(`SELECT COUNT(*) FROM email_logs WHERE ${where}`, params),
      ),
    ]);

    return ok({ data: rows, meta: { total: Number(countRows[0].count), page, limit } });
  });
}
