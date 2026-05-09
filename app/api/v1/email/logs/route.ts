import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page     = Math.max(1, Number(searchParams.get('page')  ?? 1));
  const limit    = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 50)));
  const status   = searchParams.get('status');
  const category = searchParams.get('category');
  const days     = Number(searchParams.get('days') ?? 30);
  const offset   = (page - 1) * limit;

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

  return NextResponse.json({
    success: true,
    data: { data: rows, meta: { total: Number(countRows[0].count), page, limit } },
  });
}
