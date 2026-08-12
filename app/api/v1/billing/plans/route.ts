export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { withTransaction } from '@/lib/db';
import { billingService } from '@/lib/services/billing.service';
import { PaymentRequiredError } from '@/lib/utils/errors';
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

/**
 * Claim a completed M-Pesa payment and activate the plan it bought.
 *
 * This endpoint used to activate any plan outright — `billing.manage` was the
 * only gate, so a chairperson could reach `enterprise` with no money moving.
 * The billing page ran an STK push first, but that ordering was purely
 * client-side and unverified here.
 *
 * Now the server finds a completed, unconsumed subscription payment for this
 * group and plan, and refuses if there isn't one. The M-Pesa callback also
 * activates on its own, so this is really a fast path for the client that just
 * watched its own payment succeed rather than the primary mechanism — both
 * converge on activateSubscriptionForPayment(), which is exactly-once per
 * payment, so whichever loses the race simply finds the plan already active.
 */
export async function POST(req: NextRequest): Promise<Response> {
  return withPermission(req, 'billing.manage', async (auth) => {
    const input = UpgradePlanSchema.parse(await req.json());
    const ctx   = { userId: auth.userId, groupId: auth.groupId, role: auth.role };

    return ok(await withTransaction(ctx, async (client) => {
      const claimable = await billingService.findClaimablePayment(client, {
        groupId:  auth.groupId,
        planType: input.planType,
        product:  input.product,
      });

      if (!claimable) {
        // Either no payment was made, or the callback already consumed it. The
        // second case is success from the caller's point of view, so report the
        // plan they asked for if it is already active before refusing.
        const current = await billingService.getSubscription(ctx, input.product);
        if (current?.plan_type === input.planType) return current;

        throw new PaymentRequiredError(
          `No completed payment found for the ${input.planType} plan. Pay via M-Pesa first.`,
        );
      }

      const activated = await billingService.activateSubscriptionForPayment(client, {
        groupId:    auth.groupId,
        planType:   input.planType,
        product:    input.product,
        paymentId:  claimable.paymentId,
        amountPaid: claimable.amount,
      });

      // null means the callback activated it between the lookup and here.
      return activated ?? await billingService.getSubscription(ctx, input.product);
    }));
  });
}
