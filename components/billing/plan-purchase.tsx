'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useBillingPlans, useUpgradePlan } from '@/hooks/use-billing';
import { useStkCheckout } from '@/hooks/use-stk-checkout';
import { useToast } from '@/hooks/use-toast';
import { cn, getErrorMessage } from '@/lib/utils';
import { MpesaPayDialog } from './mpesa-pay-dialog';
import type { UpgradePlanInput } from '@/lib/validators/billing.schema';
import {
  PLAN_COPY, BILLING_CYCLES, BILLING_CYCLE_MONTHS, BILLING_CYCLE_LABELS,
  type PlanType, type SubscriptionProduct, type BillingCycle,
} from '@/types/enums';

type PurchasablePlan = UpgradePlanInput['planType'];

// PLAN_COPY (display bullets, no prices — those come from GET /billing/plans,
// which reads PLAN_MONTHLY_FEES) now lives in types/enums.ts so the public
// pricing page and preview can share the exact same per-tier copy instead of
// maintaining an independent, driftable list of their own. See that file for
// the full rationale — this used to be a private const here.

const PRODUCT_REFERENCE: Record<SubscriptionProduct, string> = {
  kitabu_yetu:    'SUBSCRIPT',
  chama_reminder: 'REMINDER',
};

/**
 * The plan grid and its M-Pesa purchase flow, for one product.
 *
 * Extracted from the Kitabu Yetu billing page so the Chama Reminder portal can
 * sell its own plans without forking a payment flow. `product` is threaded all
 * the way through — plan list, price lookup, STK payload and the claim call —
 * because tiers are priced per product and the server verifies the amount paid
 * against its own table.
 */
export function PlanPurchase({ product }: { product: SubscriptionProduct }) {
  const { toast } = useToast();
  const { data: billingData, isLoading } = useBillingPlans(product);
  const upgradePlan = useUpgradePlan(product);

  const planCopy = PLAN_COPY[product];

  /** Server-quoted monthly fee. null while loading; 0 means negotiated, not free. */
  const priceOf = (type: PlanType): number | null =>
    billingData?.plans.find((p) => p.plan === type)?.monthlyFee ?? null;

  /** Enterprise is negotiated — it is never sold through the self-serve STK flow. */
  const isNegotiated = (type: PlanType) => type === 'enterprise';

  // null, not a 'starter' fallback: since migration 139 a group can genuinely
  // hold no plan, and defaulting the display to starter told a locked group it
  // was on the very plan it has not paid for — while marking that card
  // "Current plan" and disabling the button that would let it pay.
  const current         = billingData?.current;
  const currentPlanType = current?.planType ?? null;

  // Narrower than PlanType on purpose: enterprise is displayed but negotiated,
  // so it can never be the subject of a payment action. Deriving it from the
  // request schema keeps this in step with what the server will accept.
  const [pendingPlan, setPendingPlan] = useState<PurchasablePlan | null>(null);

  // One cycle applies to whichever plan gets bought — there is no per-card
  // cycle, matching how PLAN_MONTHLY_FEES prices a plan once, not per cadence.
  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const cycleMonths = BILLING_CYCLE_MONTHS[cycle];

  const checkout = useStkCheckout(() => {
    if (!pendingPlan) return;
    upgradePlan.mutate(pendingPlan, {
      onSuccess: () => toast({ title: 'Plan activated!', description: `Now on the ${pendingPlan} plan` }),
      onError:   (err) => toast({ variant: 'destructive', title: 'Activation failed', description: getErrorMessage(err) }),
    });
  });

  const handleSelectPlan = (planType: PlanType) => {
    // Every plan is paid now, so there is no free tier to short-circuit —
    // only enterprise is excluded, and it is negotiated rather than bought.
    const price = priceOf(planType);
    // The isNegotiated narrowing is what makes planType safe to put in the
    // payload: enterprise is the only non-purchasable tier.
    if (isNegotiated(planType) || price == null) return;
    const purchasable = planType as PurchasablePlan;
    setPendingPlan(purchasable);
    // StkPushSchema requires accountReference (<=12 chars) and description
    // (<=20), and `purpose` is an enum — not free text. The server re-checks
    // this amount against its own table before activating, so a tampered value
    // fails verification rather than buying a plan cheaply.
    //
    // `amount` is the FULL cycle charge (price * cycleMonths), not the bare
    // monthly price — activateSubscriptionForPayment() verifies amountPaid
    // against exactly that, and a monthly-only amount would fail the check
    // for anything but a monthly purchase.
    checkout.start({
      amount:           price * cycleMonths,
      accountReference: PRODUCT_REFERENCE[product],
      description:      `${planCopy.find((p) => p.type === planType)!.label} plan`.slice(0, 20),
      purpose:          'subscription' as const,
      planType:         purchasable,
      product,
      billingCycle:     cycle,
    });
  };

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Bill me</span>
        <div className="inline-flex rounded-md border border-input p-0.5">
          {BILLING_CYCLES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={cn(
                'rounded-[5px] px-3 py-1.5 text-sm font-medium transition-colors',
                cycle === c ? 'bg-brand-500 text-white' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {BILLING_CYCLE_LABELS[c]}
            </button>
          ))}
        </div>
        {cycle !== 'monthly' && (
          <span className="text-xs text-muted-foreground">
            Charged once for all {BILLING_CYCLE_MONTHS[cycle]} months — same per-month rate as monthly, no discount.
          </span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {planCopy.map((plan) => {
          const isCurrent  = plan.type === currentPlanType;
          const price      = priceOf(plan.type);
          const negotiated = isNegotiated(plan.type);
          return (
            <Card key={plan.type} className={cn('relative', isCurrent && 'ring-2 ring-brand-500')}>
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <Badge className="bg-brand-500 text-white">Current plan</Badge>
                </div>
              )}
              <CardHeader>
                <CardTitle>{plan.label}</CardTitle>
                <CardDescription>
                  {negotiated
                    ? 'Custom pricing'
                    : price == null
                      ? '—'
                      : cycle === 'monthly'
                        ? `KES ${price.toLocaleString()} / month`
                        : `KES ${(price * cycleMonths).toLocaleString()} / ${BILLING_CYCLE_LABELS[cycle].toLowerCase()} (KES ${price.toLocaleString()}/mo)`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check size={14} className="text-brand-500 shrink-0"/> {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  variant={isCurrent || negotiated ? 'outline' : 'default'}
                  disabled={isCurrent || isLoading || negotiated || price == null}
                  onClick={() => handleSelectPlan(plan.type)}
                >
                  {isCurrent ? 'Current plan' : negotiated ? 'Contact sales' : 'Pay via M-Pesa'}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>

      <MpesaPayDialog checkout={checkout} />
    </>
  );
}

/** The current plan line the page header shows above the grid. */
export function useCurrentPlanSummary(product: SubscriptionProduct): string {
  const { data } = useBillingPlans(product);
  const current  = data?.current;
  if (!current?.planType) return 'No active plan — choose one below to restore access.';
  const label = `${current.planType.charAt(0).toUpperCase()}${current.planType.slice(1)}`;
  const expiry = current.expiresAt
    ? ` · expires ${new Date(current.expiresAt).toLocaleDateString()}`
    : '';
  return `Current plan: ${label}${expiry}`;
}
