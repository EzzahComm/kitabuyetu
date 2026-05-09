import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { createCampaign, launchCampaign } from '@/lib/services/campaign.service';

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT id, name, subject, status, total_recipients, sent_count, failed_count,
              opened_count, scheduled_at, started_at, completed_at, created_at
       FROM email_campaigns
       WHERE group_id = $1
       ORDER BY created_at DESC`,
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
    name: string;
    subject: string;
    templateKey?: string;
    htmlBody?: string;
    recipientFilter?: unknown;
    scheduledAt?: string;
    launch?: boolean;
  };

  if (!body.name || !body.subject) {
    return NextResponse.json({ success: false, error: 'name and subject are required' }, { status: 400 });
  }

  const id = await createCampaign({
    groupId: auth.groupId!,
    createdBy: auth.userId!,
    name: body.name,
    subject: body.subject,
    templateKey: body.templateKey,
    htmlBody: body.htmlBody,
    recipientFilter: body.recipientFilter as never,
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
  });

  if (body.launch) {
    await launchCampaign(id).catch((err: Error) => {
      console.error('[campaigns] launch failed', err.message);
    });
  }

  return NextResponse.json({ success: true, data: { id } }, { status: 201 });
}
