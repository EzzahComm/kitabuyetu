export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { contributionSplitsService } from '@/lib/services/contribution-splits.service';
import {
  CreateContributionSplitSchema,
  ReplaceContributionSplitsSchema,
} from '@/lib/validators/contribution-splits.schema';
import { created, ok, handleError } from '@/lib/utils/response';

/** GET /api/v1/settings/contribution-splits — list this group's split rules. */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    try {
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const items = await contributionSplitsService.list(ctx);
      return ok({ items });
    } catch (err) {
      return handleError(err);
    }
  });
}

/** POST /api/v1/settings/contribution-splits — add one split rule (treasurer+). */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const input = CreateContributionSplitSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const row   = await contributionSplitsService.create(ctx, input);
      return created(row);
    } catch (err) {
      return handleError(err);
    }
  });
}

/** PUT /api/v1/settings/contribution-splits — replace the whole rule set (treasurer+). */
export async function PUT(req: NextRequest): Promise<Response> {
  return withPermission(req, 'treasury.manage', async (auth) => {
    try {
      const input = ReplaceContributionSplitsSchema.parse(await req.json());
      const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
      const items = await contributionSplitsService.replaceAll(ctx, input);
      return ok({ items });
    } catch (err) {
      return handleError(err);
    }
  });
}
