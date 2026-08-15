export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { withTransaction } from '@/lib/db';
import { billingService } from '@/lib/services/billing.service';
import { PaymentRequiredError } from '@/lib/utils/errors';
import { UpgradePlanSchema } from '@/lib/validators/billing.schema';
import {
  PLAN_FEATURES, PLAN_MONTHLY_FEES, DEFAULT_PRODUCT,
  type PlanType, type SubscriptionProduct,
} from '@/types/enums';
import { ok } from '@/lib/utils/response';
import { getUnitPrice } from '@/lib/services/sms-pricing.service';

/** ?product= — defaults to kitabu_yetu, so the existing billing page is unchanged. */
function readProduct(req: NextRequest): SubscriptionProduct {
  const raw = req.nextUrl.searchParams.get('product');
  return raw === 'chama_reminder' ? 'chama_reminder' : DEFAULT_PRODUCT;
}

export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async (auth) => {
    const ctx     = { userId: auth.userId, groupId: auth.groupId, role: auth.role };
    const product = readProduct(req);
    const sub      = await billingService.getSubscription(ctx, product);
    // One lookup for the whole table: the active band is the same for every
    // plan tier (SMS pricing is by VOLUME, not by subscription plan).
    const smsRate  = await getUnitPrice(0);
    // Plan tiers are scoped within a product since migration 127, so the fee
    // and rate tables are indexed by [product][plan].
    const plans = Object.entries(PLAN_FEATURES[product]).map(([plan, features]) => ({
      plan,
      product,
      monthlyFee: PLAN_MONTHLY_FEES[product][plan as PlanType],
      smsRate,
      features,
      current:    sub?.plan_type === plan,
    }));
    // Mapped to the declared SubscriptionPublic shape rather than returned
    // raw. `sub` is the snake_case DB row, but the client contract
    // (types/api.types.ts SubscriptionPublic, which lib/api/endpoints.ts's
    // billingApi.plans declares) is camelCase — so `current.planType` was
    // ALWAYS undefined and useCurrentPlanSummary reported "No active plan"
    // even for a group with a live, paid subscription. Reported in
    // production immediately after a real KES 150 Starter purchase.
    //
    // Fixed here, not by making the client read snake_case: this is the
    // declared wire contract, and the raw row also carries internals
    // (group_id, payment_id, cancel_reason) that have no business being
    // sent to a browser. Exactly the failure mode
    // CLIENT_SERVER_CONTRACT_AUDIT_2026-08.md documents — a client interface
    // that does not match the wire suppresses the very error it pretends to
    // prevent.
    const current = sub ? {
      id:              sub.id,
      planType:        sub.plan_type,
      status:          sub.status,
      startedAt:       sub.started_at,
      expiresAt:       sub.expires_at,
      nextBillingDate: sub.next_billing_date,
      monthlyFee:      sub.monthly_fee,
      smsRate:         sub.sms_rate,
      maxMembers:      sub.max_members,
      // The plan's bundled monthly SMS, so the billing page can show what the
      // subscription actually includes instead of only purchased top-ups.
      smsAllowanceIncluded: sub.sms_allowance_included,
    } : null;

    return ok({ plans, current, product });
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
