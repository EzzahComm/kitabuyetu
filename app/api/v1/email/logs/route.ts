import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb, withDb, type TenantContext } from '@/lib/db';
import { ok } from '@/lib/utils/response';
import type { PoolClient } from 'pg';

const QuerySchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  limit:    z.coerce.number().int().min(1).max(100).default(50),
  status:   z.string().optional(),
  category: z.string().optional(),
  days:     z.coerce.number().int().min(1).default(30),
});

// Phase 1 Week 1.2: `super_admin` intentionally sees email_logs across every
// group (matching analytics/route.ts's existing cross-group precedent for
// this same table), so that branch stays on the admin pool — email_logs' RLS
// policy (migration 014) is a flat `group_id = current_setting(...)` match
// with no super_admin bypass, and routing an unscoped query through it would
// silently collapse "every group" down to just the caller's own. Every other
// caller (the common case) now runs through the RLS-enforced tenant pool, so
// the `group_id = $N` clause below is defense-in-depth rather than the only
// thing preventing cross-group reads.
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const { page, limit, status, category, days } = QuerySchema.parse(
      Object.fromEntries(new URL(req.url).searchParams),
    );
    const offset = (page - 1) * limit;

    const conditions: string[] = [`created_at >= NOW() - ($1 || ' days')::interval`];
    const params: unknown[]    = [days];

    const scoped = auth.role !== 'super_admin';
    if (scoped) {
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

    const ctx: TenantContext = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };
    const runQuery = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
      scoped
        ? withDb(ctx, (db: PoolClient) => db.query<T>(sql, p))
        : withAdminDb((db: PoolClient) => db.query<T>(sql, p));

    const [{ rows }, { rows: countRows }] = await Promise.all([
      runQuery<Record<string, unknown>>(
        `SELECT id, "to", "from", subject, template_key, category, provider, status,
                provider_message_id, sent_at, opened_at, bounced_at, error_message,
                reference_type, reference_id, created_at
         FROM email_logs
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
      runQuery<{ count: string }>(`SELECT COUNT(*) FROM email_logs WHERE ${where}`, params),
    ]);

    return ok({ data: rows, meta: { total: Number(countRows[0].count), page, limit } });
  });
}
