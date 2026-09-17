import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import { withAdminDb, withDb, withTransaction, type TenantContext } from '@/lib/db';
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
 *
 * Phase 1 Week 1.2: the manual `group_id = $2` clause used to be the ONLY
 * thing standing between a tenant caller and another group's campaign —
 * BYPASSRLS meant Postgres RLS provided zero backstop. The `scoped` (normal
 * member) path now also runs through the RLS-enforced tenant pool
 * (withDb/withTransaction + TenantContext), so a bug in the WHERE clause can
 * no longer leak across groups. The `super_admin` cross-group branch is
 * DELIBERATELY kept on the admin pool: email_campaigns'/email_campaign_
 * recipients' RLS policy (migration 014) is a flat
 * `group_id = current_setting('app.current_group_id')` match with no
 * super_admin bypass, so routing that branch through withDb would silently
 * turn "any group" into "only my own group" for platform staff — a real
 * regression, not a hardening. This mirrors analytics/route.ts's existing
 * super_admin-sees-everything precedent for the same tables.
 */
export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'messaging.send', async (auth) => {
    const scoped = auth.role !== 'super_admin';
    const ctx: TenantContext = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const { rows } = scoped
      ? await withDb(ctx, (db) =>
          db.query(`SELECT * FROM email_campaigns WHERE id = $1 AND group_id = $2`, [id, auth.groupId]),
        )
      : await withAdminDb((db) =>
          db.query(`SELECT * FROM email_campaigns WHERE id = $1`, [id]),
        );
    if (!rows.length) throw new NotFoundError('Campaign', id);

    const { rows: recipients } = scoped
      ? await withDb(ctx, (db) =>
          db.query(
            `SELECT id, email, name, status, sent_at, opened_at, error_message
             FROM email_campaign_recipients WHERE campaign_id = $1 ORDER BY created_at`,
            [id],
          ),
        )
      : await withAdminDb((db) =>
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
    const ctx: TenantContext = { userId: auth.userId, groupId: auth.groupId, role: auth.role, organizationId: auth.organizationId };

    const { rows: owned } = scoped
      ? await withDb(ctx, (db) =>
          db.query(`SELECT id FROM email_campaigns WHERE id = $1 AND group_id = $2`, [id, auth.groupId]),
        )
      : await withAdminDb((db) =>
          db.query(`SELECT id FROM email_campaigns WHERE id = $1`, [id]),
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

    if (scoped) {
      await withTransaction(ctx, (db) =>
        db.query(
          `UPDATE email_campaigns SET status='cancelled' WHERE id=$1 AND group_id=$2 AND status IN ('draft','scheduled')`,
          [id, auth.groupId],
        ),
      );
    } else {
      await withAdminDb((db) =>
        db.query(
          `UPDATE email_campaigns SET status='cancelled' WHERE id=$1 AND status IN ('draft','scheduled')`,
          [id],
        ),
      );
    }
    return ok({ message: 'Campaign cancelled' });
  });
}
