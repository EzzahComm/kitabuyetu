export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPermission } from '@/lib/auth/middleware';
import { postingTemplatesService } from '@/lib/services/posting-templates.service';
import { SetPostingTemplateSchema } from '@/lib/validators/accounting.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET /api/v1/accounting/posting-templates — every posting event's effective
 *   template (which accounts it debits/credits) with resolution source.
 * PUT /api/v1/accounting/posting-templates — set a group-level override for
 *   one event. Only account codes may change; the entry structure is locked.
 *
 * treasurer+ only, same gate as the chart of accounts itself.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPermission(req, 'accounting.manage', async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await postingTemplatesService.getGroupTemplates(ctx));
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'accounting.manage', async (auth) => {
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const input = SetPostingTemplateSchema.parse(await req.json());
    await postingTemplatesService.setGroupOverride(ctx, input.event, input.lines);
    return ok(await postingTemplatesService.getGroupTemplates(ctx));
  });
}
