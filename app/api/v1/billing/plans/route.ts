export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { billingService } from '@/lib/services/billing.service';
import { UpgradePlanSchema } from '@/lib/validators/billing.schema';
import {
  PLAN_FEATURES, PLAN_MONTHLY_FEES, SMS_RATES, DEFAULT_PRODUCT,
  type PlanType, type SubscriptionProduct,
} from '@/types/enums';
import { ok } from '@/lib/utils/response';

/** ?product= — defaults to kitabu_yetu, so the existing billing page is unchanged. */
function readProduct(req: NextRequest): SubscriptionProduct {
  const raw = req.nextUrl.searchParams.get('product');
  return raw === 'chama_reminder' ? 'chama_reminder' : DEFAULT_PRODUCT;
}

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx     = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const product = readProduct(req);
    const sub     = await billingService.getSubscription(ctx, product);
    // Plan tiers are scoped within a product since migration 127, so the fee
    // and rate tables are indexed by [product][plan].
    const plans = Object.entries(PLAN_FEATURES[product]).map(([plan, features]) => ({
      plan,
      product,
      monthlyFee: PLAN_MONTHLY_FEES[product][plan as PlanType],
      smsRate:    SMS_RATES[product][plan as PlanType](0),
      features,
      current:    sub?.plan_type === plan,
    }));
    return ok({ plans, current: sub, product });
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'billing.manage', async (auth) => {
    const input = UpgradePlanSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    return ok(await billingService.upgradePlan(ctx, input.planType, input.product));
  });
}
