export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { weeklyContributionDefaultService } from '@/lib/services/weekly-contribution-default.service';
import { SetWeeklyContributionDefaultSchema } from '@/lib/validators/weekly-contribution-default.schema';
import { ok } from '@/lib/utils/response';

/**
 * GET/PUT /api/admin/config/weekly-contribution-default - the platform-wide
 * weekly contribution target every group is measured against in the weekly
 * savings-update reminder, unless it has its own override. Super-admin only.
 */

export async function GET(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok({ weeklyContribution: await weeklyContributionDefaultService.getPlatformDefault() });
  });
}

export async function PUT(req: NextRequest): Promise<Response> {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const { weeklyContribution } = SetWeeklyContributionDefaultSchema.parse(await req.json());
    await weeklyContributionDefaultService.setPlatformDefault(ctx.userId, weeklyContribution);
    return ok({ weeklyContribution });
  });
}
