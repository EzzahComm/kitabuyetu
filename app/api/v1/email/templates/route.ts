import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/lib/auth/middleware';
import { withAdminDb } from '@/lib/db';
import { ok } from '@/lib/utils/response';

const CreateTemplateSchema = z.object({
  templateKey: z.string().min(1),
  locale:      z.string().optional(),
  name:        z.string().min(1),
  subject:     z.string().min(1),
  body:        z.string().min(1),
});

// Was withAuth only (any authenticated member) — same gap the SMS templates
// route already closed with messaging.templates.view (secretary+).
export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.templates.view', async (auth) => {
    const { rows } = await withAdminDb((db) =>
      db.query(
        `SELECT id, group_id, template_key, locale, name, subject, is_active, created_at, updated_at
         FROM email_templates
         WHERE group_id = $1 OR group_id IS NULL
         ORDER BY group_id NULLS LAST, template_key, locale`,
        [auth.groupId],
      ),
    );
    return ok(rows);
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'messaging.templates.manage', async (auth) => {
    const body = CreateTemplateSchema.parse(await req.json());

    const { rows } = await withAdminDb((db) =>
      db.query(
        `INSERT INTO email_templates (group_id, template_key, locale, name, subject, body)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (group_id, template_key, locale) DO UPDATE
           SET name=$4, subject=$5, body=$6, updated_at=NOW()
         RETURNING id`,
        [
          auth.groupId,
          body.templateKey,
          body.locale ?? 'en',
          body.name,
          body.subject,
          body.body,
        ],
      ),
    );

    return ok({ id: rows[0].id }, 201);
  });
}
