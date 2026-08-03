import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { ok } from '@/lib/utils/response';
import { NotFoundError } from '@/lib/utils/errors';

const ActionSchema = z.object({ action: z.enum(['launch', 'cancel']) });

type Ctx = { params: Promise<{ id: string }> };

/**
 * OPTIMIZATION_CLEANUP_AUDIT.md Critical #4 — GET previously had no auth
 * check at all (any caller who knew/guessed a campaign UUID could read its
 * full recipient list, including email addresses), and POST checked auth
 * but never verified the campaign belonged to the caller's own group. Both
 * are now scoped to `auth.groupId` like every other tenant route, except
 * for `super_admin` which (matching analytics/route.ts's existing
 * precedent) can see/manage any group's campaigns.
 *
 * Outer gate added (messaging.send, matching SMS campaigns' equivalent GET
 * gate) — the `scoped` ternary below is untouched, it's visibility scope,
 * not the access gate.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'messaging.send', async (auth) => {
    const scoped = auth.role !== 'super_admin';
    const { rows } = await withAdminDb((db) =>
      db.query(
        scoped
          ? `SELECT * FROM email_campaigns WHERE id = $1 AND group_id = $2`
          : `SELECT * FROM email_campaigns WHERE id = $1`,
        scoped ? [id, auth.groupId] : [id],
      ),
    );
    if (!rows.length) throw new NotFoundError('Campaign', id);

    const { rows: recipients } = await withAdminDb((db) =>
      db.query(
        `SELECT id, email, name, status, sent_at, opened_at, error_message
         FROM email_campaign_recipients WHERE campaign_id = $1 ORDER BY created_at`,
        [id],
      ),
    );

    return ok({ ...rows[0], recipients });
  });
}

export async function POST(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'messaging.manage', async (auth) => {
    const { action } = ActionSchema.parse(await req.json());

    const scoped = auth.role !== 'super_admin';
    const { rows: owned } = await withAdminDb((db) =>
      db.query(
        scoped
          ? `SELECT id FROM email_campaigns WHERE id = $1 AND group_id = $2`
          : `SELECT id FROM email_campaigns WHERE id = $1`,
        scoped ? [id, auth.groupId] : [id],
      ),
    );
    if (!owned.length) throw new NotFoundError('Campaign', id);

    if (action === 'launch') {
      // OPTIMIZATION_CLEANUP_AUDIT.md High #6 — hand off to the job queue
      // instead of running the per-recipient loop inline in this request.
      await enqueueJob(
        'email_campaign_launch',
        { campaignId: id },
        { priority: 5, max_attempts: 3, dedup_key: `email_campaign_launch:${id}` },
      );
      return ok({ message: 'Campaign queued for launch' });
    }

    await withAdminDb((db) =>
      db.query(
        `UPDATE email_campaigns SET status='cancelled' WHERE id=$1 AND status IN ('draft','scheduled')`,
        [id],
      ),
    );
    return ok({ message: 'Campaign cancelled' });
  });
}
