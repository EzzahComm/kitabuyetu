import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { scheduleEmail } from '@/lib/services/email.service';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT id, name, template_key, recipient_email, schedule_type,
              next_run_at, last_run_at, is_active, created_at
       FROM email_schedules
       WHERE group_id = $1
       ORDER BY next_run_at`,
      [auth.groupId],
    ),
  );

  return NextResponse.json({ success: true, data: rows });
}

export async function POST(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  if (!['group_admin', 'treasurer', 'super_admin'].includes(auth.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json() as {
    templateKey: string;
    to: string;
    vars?: Record<string, string>;
    name?: string;
    sendAt: string;
    referenceId?: string;
    referenceType?: string;
  };

  if (!body.templateKey || !body.to || !body.sendAt) {
    return NextResponse.json({ success: false, error: 'templateKey, to, sendAt required' }, { status: 400 });
  }

  const id = await scheduleEmail({
    templateKey: body.templateKey,
    to: body.to,
    vars: body.vars ?? {},
    groupId: auth.groupId,
    userId: auth.userId,
    sendAt: new Date(body.sendAt),
    name: body.name,
    referenceId: body.referenceId,
    referenceType: body.referenceType,
  });

  return NextResponse.json({ success: true, data: { id } }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { id: string; isActive: boolean };

  await withAdminDb((db) =>
    db.query(
      `UPDATE email_schedules SET is_active=$1, updated_at=NOW() WHERE id=$2 AND group_id=$3`,
      [body.isActive, body.id, auth.groupId],
    ),
  );

  return NextResponse.json({ success: true });
}
