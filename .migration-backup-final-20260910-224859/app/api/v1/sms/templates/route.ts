export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { withDb, withAdminDb } from '@/lib/db';
import { TemplateCreateSchema, TemplateUpdateSchema } from '@/lib/validators/sms.schema';
import { extractVars } from '@/lib/sms/templates';
import { ok, notFound } from '@/lib/utils/response';

function normalizeTemplatePayload<T extends { variables?: string[] | null; body?: string }>(row: T) {
  return {
    ...row,
    variables: row.variables ?? extractVars(row.body ?? ''),
  };
}

// GET /api/v1/sms/templates â€” list group + system templates
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.templates.view', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return withDb(ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM sms_templates
         WHERE (group_id=$1 OR group_id IS NULL) AND is_active=true
         ORDER BY is_system DESC, created_at DESC`,
        [auth.groupId],
      );
      return ok(rows.map(normalizeTemplatePayload));
    });
  });
}

// POST /api/v1/sms/templates â€” create custom template
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.templates.manage', async (auth) => {
    const body  = await req.json();
    const input = TemplateCreateSchema.parse(body);
    const vars  = extractVars(input.body);

    const { rows: [tpl] } = await withAdminDb((db) =>
      db.query(
        `INSERT INTO sms_templates
           (group_id, template_key, name, body, variables, category, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [auth.groupId, input.templateKey, input.name, input.body, vars, input.category, auth.userId],
      ),
    );
    return ok(normalizeTemplatePayload(tpl), 201);
  });
}

// PATCH /api/v1/sms/templates?id=xxx â€” update template
export async function PATCH(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.templates.manage', async (auth) => {
    const id   = new URL(req.url).searchParams.get('id');
    if (!id) return notFound();
    const body  = await req.json();
    const input = TemplateUpdateSchema.parse(body);

    const sets: string[] = ['updated_at=NOW()'];
    const vals: unknown[] = [id, auth.groupId];
    let idx = 3;

    if (input.name !== undefined)     { sets.push(`name=$${idx++}`);     vals.push(input.name); }
    if (input.body !== undefined)     {
      sets.push(`body=$${idx++}`);     vals.push(input.body);
      sets.push(`variables=$${idx++}`); vals.push(extractVars(input.body));
    }
    if (input.category !== undefined) { sets.push(`category=$${idx++}`); vals.push(input.category); }

    const { rows } = await withAdminDb((db) =>
      db.query(
        `UPDATE sms_templates SET ${sets.join(',')}
         WHERE id=$1 AND group_id=$2 AND is_system=false RETURNING *`,
        vals,
      ),
    );
    if (!rows.length) return notFound();
    return ok(normalizeTemplatePayload(rows[0]));
  });
}

// DELETE /api/v1/sms/templates?id=xxx â€” soft delete
export async function DELETE(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.templates.manage', async (auth) => {
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return notFound();

    const { rows } = await withAdminDb((db) =>
      db.query(
        `UPDATE sms_templates SET is_active=false, updated_at=NOW()
         WHERE id=$1 AND group_id=$2 AND is_system=false RETURNING id`,
        [id, auth.groupId],
      ),
    );
    if (!rows.length) return notFound();
    return ok({ deleted: true });
  });
}
