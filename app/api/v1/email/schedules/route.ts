import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPermission, withAnyPermission } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { scheduleEmail } from '@/lib/services/email.service';
import { ok } from '@/lib/utils/response';
import { NotFoundError } from '@/lib/utils/errors';

const CreateScheduleSchema = z.object({
  templateKey:   z.string().min(1),
  to:            z.string().min(1),
  vars:          z.record(z.string()).optional(),
  name:          z.string().optional(),
  sendAt:        z.string().datetime(),
  referenceId:   z.string().optional(),
  referenceType: z.string().optional(),
});

const UpdateScheduleSchema = z.object({
  id:       z.string(),
  isActive: z.boolean(),
});

// Was withAuth only (any authenticated member) — the exact same gap as
// email/templates' missing GET gate, mirrored here: SMS's equivalent
// (GET /api/v1/sms/schedules) already requires messaging.schedules.view.
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.schedules.view', async (auth) => {
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
    return ok(rows);
  });
}

// Was withOneOf(['chairperson','treasurer','super_admin']) — no single
// existing permission string covers exactly {treasurer, chairperson}, so
// this composes two that do (treasury.manage ⊆ {treasurer,chairperson},
// messaging.manage ⊆ {chairperson}) rather than inventing a new one;
// super_admin still bypasses via requireAnyPermission. Exact behavior match.
export async function POST(req: NextRequest): Promise<Response> {
  return withAnyPermission(req, ['messaging.manage', 'treasury.manage'], async (auth) => {
    const body = CreateScheduleSchema.parse(await req.json());

    const id = await scheduleEmail({
      templateKey:   body.templateKey,
      to:            body.to,
      vars:          body.vars ?? {},
      groupId:       auth.groupId,
      userId:        auth.userId,
      sendAt:        new Date(body.sendAt),
      name:          body.name,
      referenceId:   body.referenceId,
      referenceType: body.referenceType,
    });

    return ok({ id }, 201);
  });
}

// Was withAuth only (any member could toggle any schedule's isActive) —
// same gap class as GET above; matches SMS schedules' PATCH gate.
export async function PATCH(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.schedules.manage', async (auth) => {
    const body = UpdateScheduleSchema.parse(await req.json());

    const { rowCount } = await withAdminDb((db) =>
      db.query(
        `UPDATE email_schedules SET is_active=$1, updated_at=NOW() WHERE id=$2 AND group_id=$3`,
        [body.isActive, body.id, auth.groupId],
      ),
    );
    if (!rowCount) throw new NotFoundError('Email schedule', body.id);

    return ok({ success: true });
  });
}
