export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withRole } from '@/lib/auth/middleware';
import { billingService } from '@/lib/services/billing.service';
import { UpgradePlanSchema } from '@/lib/validators/billing.schema';
import { PLAN_FEATURES, PLAN_MONTHLY_FEES, SMS_RATES } from '@/types/enums';
import { ok } from '@/lib/utils/response';

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const sub = await billingService.getSubscription(ctx);
    const plans = Object.entries(PLAN_FEATURES).map(([plan, features]) => ({
      plan,
      monthlyFee: PLAN_MONTHLY_FEES[plan as keyof typeof PLAN_MONTHLY_FEES],
      smsRate:    SMS_RATES[plan as keyof typeof SMS_RATES](0),
      features,
      current:    sub?.plan_type === plan,
    }));
    return ok({ plans, current: sub });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withRole(req, 'group_admin', async (auth) => {
    const input = UpgradePlanSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await billingService.upgradePlan(ctx, input.planType));
  });
}
