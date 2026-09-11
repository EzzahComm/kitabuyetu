export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withDb, withAdminDb } from '@/lib/db';
import { enqueueJob } from '@/lib/jobs';
import { CampaignCreateSchema } from '@/lib/validators/sms.schema';
import { resolveSmsRecipients } from '@/lib/services/sms.service';
import { enforceSmsRateLimit } from '@/lib/sms/rate-limit';
import { ForbiddenError } from '@/lib/utils/errors';
import { ok, notFound } from '@/lib/utils/response';

// GET /api/v1/sms/campaign â€” list campaigns
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const { searchParams } = new URL(req.url);
    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit  = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10)));
    const status = searchParams.get('status');
    const ctx    = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    return withDb(ctx, async (client) => {
      const conds: string[] = ['group_id=$1'];
      const vals: unknown[] = [auth.groupId];
      let idx = 2;
      if (status) { conds.push(`status=$${idx++}`); vals.push(status); }

      const where  = conds.join(' AND ');
      const offset = (page - 1) * limit;

      const { rows: countRows } = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM sms_campaigns WHERE ${where}`, vals,
      );
      const total = parseInt(countRows[0].count, 10);

      const { rows } = await client.query(
        `SELECT * FROM sms_campaigns WHERE ${where}
         ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...vals, limit, offset],
      );

      return ok({ items: rows, total, page, pageSize: limit, totalPages: Math.ceil(total / limit) });
    });
  });
}

// POST /api/v1/sms/campaign â€” create & optionally send
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.send', async (auth) => {
    const limited = await enforceSmsRateLimit('campaign', auth.groupId);
    if (limited) return limited;

    const body  = await req.json();
    const input = CampaignCreateSchema.parse(body);

    // Only a coordinator of an organization may spend that organization's SMS
    // credits. debit_organization_sms_credits() independently re-checks that the
    // group holds active access under the organization, so a forged header
    // cannot bill an unrelated organization.
    if (input.fundedBy === 'organization' && auth.organizationId !== input.organizationId) {
      throw new ForbiddenError('You cannot fund a campaign from this organization.');
    }
    const payerOrgId = input.fundedBy === 'organization' ? input.organizationId! : null;

    // Resolve recipient phones (shared with the scheduler so scheduled and
    // immediate campaigns resolve membership identically).
    const phones = await resolveSmsRecipients(auth.groupId, input.recipientType, input.rawRecipients);

    // Insert campaign row
    //
    // $9 (scheduled_at) is reused a second time inside the CASE below to
    // derive `status` — the same parameter-type-inference failure class this
    // codebase has hit three times already (sms.service.ts's updateLogRow,
    // notifications.service.ts's insertSmsLog, reminder_dispatch_log.settle):
    // node-pg sends no type OIDs, and a bare $9 used only via `IS NOT NULL`
    // on its second occurrence gives Postgres nothing to resolve a type from,
    // so it throws `could not determine data type of parameter $9` — on
    // EVERY call, not just scheduled ones, since this fails at parse time
    // before any value is even bound. Cast explicitly at both occurrences.
    const { rows: [campaign] } = await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_campaigns
           (group_id, name, description, message, template_id, recipient_type,
            recipient_count, raw_recipients, scheduled_at, created_by, status,
            payer_type, payer_organization_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,
           CASE WHEN $9::timestamptz IS NOT NULL THEN 'scheduled' ELSE 'draft' END, $11, $12)
         RETURNING *`,
        [
          auth.groupId, input.name, input.description ?? null,
          input.message, input.templateId ?? null, input.recipientType,
          phones.length, input.rawRecipients ? JSON.stringify(input.rawRecipients) : null,
          input.scheduledAt ?? null, auth.userId,
          input.fundedBy, payerOrgId,
        ],
      ),
    );

    // Send immediately if not scheduled — enqueue a durable dispatch job
    // (dedup-keyed on the campaign id so a retried request can't double-send).
    if (!input.scheduledAt && phones.length > 0) {
      await enqueueJob(
        'sms_bulk_send',
        {
          campaignId: campaign.id,
          phones,
          message:    input.message,
          senderId:   input.senderId,
          groupId:    auth.groupId,
          sentBy:     auth.userId,
          fundedBy:   input.fundedBy,
          payerOrganizationId: payerOrgId,
        },
        { priority: 7, max_attempts: 3, dedup_key: `sms_bulk_send:${campaign.id}` },
      );
    }

    return ok(campaign, 201);
  });
}

// DELETE /api/v1/sms/campaign?id=xxx â€” cancel
export async function DELETE(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.manage', async (auth) => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return notFound();

    const { rows } = await withAdminDb((db) =>
      db.query(
        `UPDATE sms_campaigns
         SET status='cancelled', updated_at=NOW()
         WHERE id=$1 AND group_id=$2 AND status IN ('draft','scheduled')
         RETURNING id`,
        [id, auth.groupId],
      ),
    );
    if (!rows.length) return notFound();
    return ok({ cancelled: true });
  });
}
