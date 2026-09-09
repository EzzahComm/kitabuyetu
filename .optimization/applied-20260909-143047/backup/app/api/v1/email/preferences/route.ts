import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';

const VALID_CATEGORIES = [
  'financial_reports', 'loan_updates', 'contribution_updates',
  'meeting_invitations', 'announcements', 'billing', 'birthday',
  'weekly_summary', 'monthly_statement',
] as const;

const PreferencesSchema = z.array(z.object({
  category:  z.enum(VALID_CATEGORIES),
  enabled:   z.boolean(),
  frequency: z.string().optional(),
  groupId:   z.string().optional(),
}));

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
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

    return ok(merged);
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const prefs = PreferencesSchema.parse(await req.json());

    for (const pref of prefs) {
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

    return ok({ success: true });
  });
}
