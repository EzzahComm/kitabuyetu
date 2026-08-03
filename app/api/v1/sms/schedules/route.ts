export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withDb, withAdminDb } from '@/lib/db';
import { ScheduleCreateSchema } from '@/lib/validators/sms.schema';
import { ok, notFound } from '@/lib/utils/response';

// GET /api/v1/sms/schedules
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.schedules.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return withDb(ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT s.*, t.name AS template_name
         FROM sms_schedules s
         LEFT JOIN sms_templates t ON t.id=s.template_id
         WHERE s.group_id=$1
         ORDER BY s.created_at DESC`,
        [auth.groupId],
      );
      return ok(rows);
    });
  });
}

// POST /api/v1/sms/schedules
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.schedules.manage', async (auth) => {
    const body  = await req.json();
    const input = ScheduleCreateSchema.parse(body);

    const { rows: [schedule] } = await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_schedules
           (group_id, name, description, schedule_type, template_id, message,
            recipient_type, raw_recipients, cron_expression, next_run_at,
            timezone, days_before_due, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [
          auth.groupId,
          input.name,
          input.description ?? null,
          input.scheduleType,
          input.templateId ?? null,
          input.message ?? null,
          input.recipientType,
          input.rawRecipients ? JSON.stringify(input.rawRecipients) : null,
          input.cronExpression ?? null,
          input.nextRunAt ?? null,
          input.timezone,
          input.daysBefore ?? null,
          input.isActive,
          auth.userId,
        ],
      ),
    );
    return ok(schedule, 201);
  });
}

// PATCH /api/v1/sms/schedules?id=xxx
export async function PATCH(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.schedules.manage', async (auth) => {
    const id   = new URL(req.url).searchParams.get('id');
    if (!id) return notFound();
    const body  = await req.json();
    const input = ScheduleCreateSchema.partial().parse(body);

    const sets: string[] = ['updated_at=NOW()'];
    const vals: unknown[] = [id, auth.groupId];
    let idx = 3;

    const fieldMap: Record<string, string> = {
      name: 'name',
      description: 'description',
      message: 'message',
      scheduleType: 'schedule_type',
      templateId: 'template_id',
      recipientType: 'recipient_type',
      rawRecipients: 'raw_recipients',
      cronExpression: 'cron_expression',
      nextRunAt: 'next_run_at',
      timezone: 'timezone',
      daysBefore: 'days_before_due',
      isActive: 'is_active',
    };
    for (const [jsKey, col] of Object.entries(fieldMap)) {
      const val = (input as Record<string, unknown>)[jsKey];
      if (val !== undefined) {
        sets.push(`${col}=$${idx++}`);
        vals.push(val);
      }
    }

    const { rows } = await withAdminDb((db) =>
      db.query(
        `UPDATE sms_schedules SET ${sets.join(',')}
         WHERE id=$1 AND group_id=$2 RETURNING *`,
        vals,
      ),
    );
    if (!rows.length) return notFound();
    return ok(rows[0]);
  });
}

// DELETE /api/v1/sms/schedules?id=xxx
export async function DELETE(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.schedules.manage', async (auth) => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return notFound();

    const { rows } = await withAdminDb((db) =>
      db.query(
        `DELETE FROM sms_schedules WHERE id=$1 AND group_id=$2 RETURNING id`,
        [id, auth.groupId],
      ),
    );
    if (!rows.length) return notFound();
    return ok({ deleted: true });
  });
}
