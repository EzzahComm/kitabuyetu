export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { withDb, withAdminDb } from '@/lib/db';
import { CampaignCreateSchema } from '@/lib/validators/sms.schema';
import { smsService } from '@/lib/services/sms.service';
import { ok, notFound } from '@/lib/utils/response';
import { normalizePhone } from '@/lib/utils/phone';
import { logger } from '@/lib/logger';

// GET /api/v1/sms/campaign â€” list campaigns
export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'secretary', async (auth) => {
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
  return withRole(req, 'secretary', async (auth) => {
    const body  = await req.json();
    const input = CampaignCreateSchema.parse(body);
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    // Resolve recipient phones
    let phones: string[] = [];
    if (input.recipientType === 'all_members' || input.recipientType === 'active_members') {
      const activeOnly = input.recipientType === 'active_members';
      const { rows } = await withDb(ctx, (client) =>
        client.query<{ phone: string }>(
          `SELECT phone FROM members WHERE group_id=$1 ${activeOnly ? "AND status='active'" : ''} AND phone IS NOT NULL`,
          [auth.groupId],
        ),
      );
      phones = rows.map((r) => normalizePhone(r.phone));
    } else if (input.recipientType === 'custom_phones') {
      const raw = (input.rawRecipients as { phones?: string[] })?.phones ?? [];
      phones = raw.map(normalizePhone);
    } else if (input.recipientType === 'selected') {
      const ids = (input.rawRecipients as { memberIds?: string[] })?.memberIds ?? [];
      if (ids.length) {
        const { rows } = await withDb(ctx, (client) =>
          client.query<{ phone: string }>(
            `SELECT phone FROM members WHERE id=ANY($1::uuid[]) AND group_id=$2`,
            [ids, auth.groupId],
          ),
        );
        phones = rows.map((r) => normalizePhone(r.phone));
      }
    }

    // Insert campaign row
    const { rows: [campaign] } = await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_campaigns
           (group_id, name, description, message, template_id, recipient_type,
            recipient_count, raw_recipients, scheduled_at, created_by, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           CASE WHEN $9 IS NOT NULL THEN 'scheduled' ELSE 'draft' END)
         RETURNING *`,
        [
          auth.groupId, input.name, input.description ?? null,
          input.message, input.templateId ?? null, input.recipientType,
          phones.length, input.rawRecipients ? JSON.stringify(input.rawRecipients) : null,
          input.scheduledAt ?? null, auth.userId,
        ],
      ),
    );

    // Send immediately if not scheduled
    if (!input.scheduledAt && phones.length > 0) {
      setImmediate(async () => {
        try {
          await smsService.sendBulkCampaign({
            campaignId: campaign.id,
            phones,
            message:   input.message,
            senderId:  (input as any).senderId,
            groupId:   auth.groupId,
            sentBy:    auth.userId,
          });
        } catch (err) {
          logger.error('[campaign] send error:', err);
        }
      });
    }

    return ok(campaign, 201);
  });
}

// DELETE /api/v1/sms/campaign?id=xxx â€” cancel
export async function DELETE(req: NextRequest): Promise<Response> {
  return withRole(req, 'group_admin', async (auth) => {
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
