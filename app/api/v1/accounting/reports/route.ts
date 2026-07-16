export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withRole } from '@/lib/auth/middleware';
import { accountingService } from '@/lib/services/accounting.service';
import { ReportQuerySchema, BalanceSheetQuerySchema } from '@/lib/validators/accounting.schema';
import { ok, errorResponse } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withRole(req, 'treasurer', async (auth) => {
    const { searchParams } = req.nextUrl;
    const type = searchParams.get('type') ?? 'trial_balance';
    const ctx  = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    if (type === 'trial_balance') {
      return ok(await accountingService.getTrialBalance(ctx));
    }

    if (type === 'profit_and_loss') {
      const { from, to } = ReportQuerySchema.parse(Object.fromEntries(searchParams));
      return ok(await accountingService.getProfitAndLoss(ctx, from, to));
    }

    if (type === 'balance_sheet') {
      const { asOf } = BalanceSheetQuerySchema.parse(Object.fromEntries(searchParams));
      const date = asOf ?? new Date().toISOString().split('T')[0];
      return ok(await accountingService.getBalanceSheet(ctx, date));
    }

    if (type === 'cash_flow') {
      const { from, to } = ReportQuerySchema.parse(Object.fromEntries(searchParams));
      return ok(await accountingService.getCashFlowStatement(ctx, from, to));
    }

    if (type === 'equity_changes') {
      const { from, to } = ReportQuerySchema.parse(Object.fromEntries(searchParams));
      return ok(await accountingService.getEquityChanges(ctx, from, to));
    }

    return errorResponse(`Unknown report type: ${type}`, 'INVALID_PARAM', 400);
  });
}
