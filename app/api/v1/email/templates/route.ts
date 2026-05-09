import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT id, group_id, template_key, locale, name, subject, is_active, created_at, updated_at
       FROM email_templates
       WHERE group_id = $1 OR group_id IS NULL
       ORDER BY group_id NULLS LAST, template_key, locale`,
      [auth.groupId],
    ),
  );

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!['group_admin', 'super_admin'].includes(auth.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    templateKey: string;
    locale?: string;
    name: string;
    subject: string;
    body: string;
  };

  if (!body.templateKey || !body.name || !body.subject || !body.body) {
    return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 });
  }

  const { rows } = await withAdminDb((db) =>
    db.query(
      `INSERT INTO email_templates (group_id, template_key, locale, name, subject, body)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (group_id, template_key, locale) DO UPDATE
         SET name=$4, subject=$5, body=$6, updated_at=NOW()
       RETURNING id`,
      [
        auth.groupId,
        body.templateKey,
        body.locale ?? 'en',
        body.name,
        body.subject,
        body.body,
      ],
    ),
  );

  return NextResponse.json({ success: true, data: { id: rows[0].id } }, { status: 201 });
}
