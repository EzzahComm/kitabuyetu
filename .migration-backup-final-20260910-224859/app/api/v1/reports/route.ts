export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { reportsService } from '@/lib/services/reports.service';
import { ok, errorResponse } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type') ?? 'contribution';
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (type === 'contribution') {
      const from = searchParams.get('from') ?? new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
      const to   = searchParams.get('to')   ?? new Date().toISOString().split('T')[0];
      return ok(await reportsService.contributionSummary(ctx, from, to));
    }

    if (type === 'loans') {
      return ok(await reportsService.loanReport(ctx));
    }

    if (type === 'financial') {
      const from = searchParams.get('from');
      const to   = searchParams.get('to');
      if (!from || !to) return errorResponse('from and to are required for financial reports', 'VALIDATION_ERROR', 422);
      return ok(await reportsService.financialReport(ctx, from, to));
    }

    return errorResponse(`Unknown report type: ${type}. Use: contribution | loans | financial`, 'INVALID_PARAM', 400);
  });
}
