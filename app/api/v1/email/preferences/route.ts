import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';

const VALID_CATEGORIES = [
  'financial_reports', 'loan_updates', 'contribution_updates',
  'meeting_invitations', 'announcements', 'billing', 'birthday',
  'weekly_summary', 'monthly_statement',
];

export async function GET(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { rows } = await withAdminDb((db) =>
    db.query(
      `SELECT id, category, enabled, frequency, group_id
       FROM email_preferences
       WHERE member_id = $1
       ORDER BY category`,
      [auth.userId],
    ),
  );

  // Merge with defaults (all enabled)
  const existing = new Map(rows.map((r: { category: string }) => [r.category, r]));
  const merged = VALID_CATEGORIES.map((cat) => existing.get(cat) ?? {
    category: cat, enabled: true, frequency: 'immediate', group_id: null,
  });

  return NextResponse.json({ success: true, data: merged });
}

export async function PUT(req: NextRequest) {
  const auth = await getAuthContext(req);
  if (!auth) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json() as { category: string; enabled: boolean; frequency?: string; groupId?: string }[];

  for (const pref of body) {
    if (!VALID_CATEGORIES.includes(pref.category)) continue;

    await withAdminDb((db) =>
      db.query(
        `INSERT INTO email_preferences (member_id, group_id, category, enabled, frequency)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT ON CONSTRAINT idx_email_pref_global DO UPDATE
           SET enabled=$4, frequency=$5, updated_at=NOW()`,
        [
          auth.userId,
          pref.groupId ?? null,
          pref.category,
          pref.enabled,
          pref.frequency ?? 'immediate',
        ],
      ),
    ).catch(() =>
      withAdminDb((db) =>
        db.query(
          `UPDATE email_preferences
           SET enabled=$1, frequency=$2, updated_at=NOW()
           WHERE member_id=$3 AND category=$4`,
          [pref.enabled, pref.frequency ?? 'immediate', auth.userId, pref.category],
        ),
      ),
    );
  }

  return NextResponse.json({ success: true });
}
