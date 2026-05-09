import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { launchCampaign } from '@/lib/services/campaign.service';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { rows } = await withAdminDb((db) =>
    db.query(`SELECT * FROM email_campaigns WHERE id = $1`, [id]),
  );
  if (!rows.length) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

  const { rows: recipients } = await withAdminDb((db) =>
    db.query(
      `SELECT id, email, name, status, sent_at, opened_at, error_message
       FROM email_campaign_recipients WHERE campaign_id = $1 ORDER BY created_at`,
      [id],
    ),
  );

  return NextResponse.json({ success: true, data: { ...rows[0], recipients } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { action: string };

  if (body.action === 'launch') {
    await launchCampaign(id);
    return NextResponse.json({ success: true, message: 'Campaign launched' });
  }

  if (body.action === 'cancel') {
    await withAdminDb((db) =>
      db.query(
        `UPDATE email_campaigns SET status='cancelled' WHERE id=$1 AND status IN ('draft','scheduled')`,
        [id],
      ),
    );
    return NextResponse.json({ success: true, message: 'Campaign cancelled' });
  }

  return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
}
