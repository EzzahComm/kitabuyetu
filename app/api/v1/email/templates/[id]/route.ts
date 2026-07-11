import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rows } = await withAdminDb((db) =>
    db.query(`SELECT * FROM email_templates WHERE id = $1`, [id]),
  );
  if (!rows.length) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  return NextResponse.json({ success: true, data: rows[0] });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!['chairperson', 'super_admin'].includes(auth.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as { name?: string; subject?: string; body?: string; isActive?: boolean };

  await withAdminDb((db) =>
    db.query(
      `UPDATE email_templates
       SET name     = COALESCE($1, name),
           subject  = COALESCE($2, subject),
           body     = COALESCE($3, body),
           is_active= COALESCE($4, is_active),
           updated_at = NOW()
       WHERE id = $5`,
      [body.name ?? null, body.subject ?? null, body.body ?? null, body.isActive ?? null, id],
    ),
  );

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!['chairperson', 'super_admin'].includes(auth.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  await withAdminDb((db) =>
    db.query(`DELETE FROM email_templates WHERE id = $1`, [id]),
  );

  return NextResponse.json({ success: true });
}
