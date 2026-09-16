import { NextRequest } from 'next/server';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { withPermission } from '@/lib/auth/middleware';
import { withDb, type TenantContext } from '@/lib/db';
import { ok } from '@/lib/utils/response';
import { NotFoundError, ForbiddenError } from '@/lib/utils/errors';

const UpdateTemplateSchema = z.object({
  name:     z.string().optional(),
  subject:  z.string().optional(),
  body:     z.string().optional(),
  isActive: z.boolean().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

interface TemplateRow { group_id: string | null }

/**
 * OPTIMIZATION_CLEANUP_AUDIT.md Critical #4 — GET previously had no auth
 * check, and PUT/DELETE never verified the template belonged to the
 * caller's group (or that a platform-wide template, `group_id IS NULL`,
 * was only editable by a super_admin) — any authenticated member of any
 * group could read, edit, or delete any other group's templates, or the
 * shared platform-wide defaults every group falls back to.
 *
 * Refactored (2026-09-16) to use client parameter within withDb context.
 */
async function assertOwnership(
  client: PoolClient,
  id: string,
  auth: { groupId: string; role: string }
): Promise<void> {
  const result = await client.query<TemplateRow>(
    `SELECT group_id FROM email_templates WHERE id = $1`,
    [id]
  );
  if (!result.rows.length) throw new NotFoundError('Email template', id);

  const ownerGroupId = result.rows[0].group_id;
  if (ownerGroupId === null) {
    if (auth.role !== 'super_admin') {
      throw new ForbiddenError('Only a super_admin can modify a platform-wide template');
    }
    return;
  }
  if (ownerGroupId !== auth.groupId && auth.role !== 'super_admin') {
    throw new NotFoundError('Email template', id);
  }
}

export async function GET(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'messaging.templates.view', async (auth) => {
    const ctx: TenantContext = {
      userId: auth.userId,
      groupId: auth.groupId,
      role: auth.role,
      organizationId: auth.organizationId,
    };

    return withDb(ctx, async (client) => {
      const result = await client.query(
        `SELECT * FROM email_templates WHERE id = $1 AND (group_id = $2 OR group_id IS NULL)`,
        [id, auth.groupId],
      );
      if (!result.rows.length) throw new NotFoundError('Email template', id);
      return ok(result.rows[0]);
    });
  });
}

export async function PUT(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'messaging.templates.manage', async (auth) => {
    const body = UpdateTemplateSchema.parse(await req.json());

    const ctx: TenantContext = {
      userId: auth.userId,
      groupId: auth.groupId,
      role: auth.role,
      organizationId: auth.organizationId,
    };

    return withDb(ctx, async (client) => {
      await assertOwnership(client, id, auth);

      await client.query(
        `UPDATE email_templates
         SET name     = COALESCE($1, name),
             subject  = COALESCE($2, subject),
             body     = COALESCE($3, body),
             is_active= COALESCE($4, is_active),
             updated_at = NOW()
         WHERE id = $5`,
        [body.name ?? null, body.subject ?? null, body.body ?? null, body.isActive ?? null, id],
      );

      return ok({ success: true });
    });
  });
}

export async function DELETE(req: NextRequest, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return withPermission(req, 'messaging.templates.manage', async (auth) => {
    const ctx: TenantContext = {
      userId: auth.userId,
      groupId: auth.groupId,
      role: auth.role,
      organizationId: auth.organizationId,
    };

    return withDb(ctx, async (client) => {
      await assertOwnership(client, id, auth);

      await client.query(`DELETE FROM email_templates WHERE id = $1`, [id]);

      return ok({ success: true });
    });
  });
}
