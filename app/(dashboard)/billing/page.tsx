'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/shared/page-header';
import {
  useBillingPlans, useUpgradePlan, useStkPush, usePollMpesa, useSmsCreditBalance, billingKeys,
} from '@/hooks/use-billing';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { cn, getErrorMessage } from '@/lib/utils';
import type { UpgradePlanInput } from '@/lib/validators/billing.schema';
import type { PlanType } from '@/types/enums';

/**
 * The plans a group can actually buy here. Narrower than PlanType on purpose:
 * enterprise is displayed but negotiated, so it can never be the subject of a
 * payment action. Deriving it from the request schema keeps this in step with
 * what the server will accept.
 */
type PurchasablePlan = UpgradePlanInput['planType'];

/**
 * Display copy only — NO prices. Prices come from GET /billing/plans, which
 * reads PLAN_MONTHLY_FEES, the same table the M-Pesa callback verifies the
 * paid amount against. This array used to carry its own prices (growth 2500,
 * enterprise 8000) that disagreed with the server's (1000, negotiated): the
 * client's number was what customers were actually charged, while the server
 * quoted a different one on the same page. With activation now gated on the
 * server checking amount-paid against its own table, a second copy here would
 * mean customers paying an amount that fails verification.
 */
const PLAN_COPY: { type: PlanType; label: string; features: string[] }[] = [
  { type: 'starter',    label: 'Starter',    features: ['Basic reporting', 'M-Pesa integration', 'SMS included'] },
  { type: 'growth',     label: 'Growth',     features: ['All Starter features', 'Advanced reports', 'Accounting module'] },
  { type: 'premium',    label: 'Premium',    features: ['All Growth features', 'Priority support', 'Higher SMS allowance'] },
  { type: 'enterprise', label: 'Enterprise', features: ['All Premium features', 'Enterprise portal', 'API access', 'Dedicated support'] },
];

const SMS_TOPUP_PRESETS = [500, 1000, 2500, 5000];
/** Below this many credits the balance card switches to a "Low balance" warning. */
const LOW_SMS_CREDITS_THRESHOLD = 50;

// One STK-push flow (phone entry → prompt → poll) is shared by both actions
// this page can trigger — plan upgrade and SMS credit top-up — so there is
// exactly one payment dialog, keyed off which action is pending.
type PendingAction =
  | { kind: 'plan';       planType: PurchasablePlan }
  | { kind: 'sms_topup';  amount: number };

export default function BillingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: billingData, isLoading } = useBillingPlans();
  const { data: smsBalance, isLoading: smsBalanceLoading } = useSmsCreditBalance();
  const upgradePlan = useUpgradePlan();
  const stkPush     = useStkPush();

  const [checkoutId, setCheckoutId]       = useState<string | null>(null);
  const [polling, setPolling]             = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [phone, setPhone]                 = useState('');
  const [mpesaOpen, setMpesaOpen]         = useState(false);
  const [topupAmount, setTopupAmount]     = useState<number>(SMS_TOPUP_PRESETS[0]);

  const { data: mpesaStatus } = usePollMpesa(checkoutId, polling);

  // Effect responds to M-Pesa polling result (external async system).
  // The setState calls here stop polling and close the modal on terminal
  // status — this is the "subscribe to external system" pattern, not the
  // copy-data-to-state anti-pattern the rule normally guards against.
  useEffect(() => {
    if (!mpesaStatus || !pendingAction) return;
    if (mpesaStatus.status === 'completed') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPolling(false);
      setMpesaOpen(false);
      if (pendingAction.kind === 'plan') {
        upgradePlan.mutate(pendingAction.planType, {
          onSuccess: () => toast({ title: 'Plan upgraded!', description: `Now on ${pendingAction.planType} plan` }),
          onError:   (err) => toast({ variant: 'destructive', title: 'Upgrade failed', description: getErrorMessage(err) }),
        });
      } else {
        // Crediting itself happens server-side off the M-Pesa callback
        // (mpesa/callback/route.ts → billingService.addSmsCredits) — nothing
        // left to do here but refresh the balance and confirm. Note the
        // callback is processed asynchronously (Next's after()), so the
        // invalidated balance query may still read the pre-credit value on the
        // first refetch; the balance card catches up on the next poll/refocus.
        qc.invalidateQueries({ queryKey: billingKeys.smsCredits });
        toast({ title: 'Credits added', description: `KES ${pendingAction.amount.toLocaleString()} of SMS credits added to your balance` });
      }
    } else if (mpesaStatus.status === 'failed') {
      setPolling(false);
      toast({ variant: 'destructive', title: 'Payment failed', description: 'M-Pesa payment was not completed' });
    }
  }, [mpesaStatus, pendingAction, toast, upgradePlan, qc]);

  const handleSelectPlan = (planType: PlanType) => {
    // Every plan is paid now, so there is no free tier to short-circuit —
    // only enterprise is excluded, and it is negotiated rather than bought.
    // The narrowing here is what makes `planType` safe to put in the payload.
    if (planType === 'enterprise' || priceOf(planType) == null) return;
    setPendingAction({ kind: 'plan', planType });
    setMpesaOpen(true);
  };

  const handleBuySmsCredits = () => {
    if (!topupAmount || topupAmount < 1) return;
    setPendingAction({ kind: 'sms_topup', amount: Math.round(topupAmount) });
    setMpesaOpen(true);
  };

  const handleMpesaPay = async () => {
    if (!pendingAction || !phone) return;
    try {
      // StkPushSchema (app/api/v1/mpesa/stk-push/route.ts) requires
      // accountReference (<=12 chars) and description (<=20), and `purpose` is
      // an enum — not free text. This used to send only {phone, amount, purpose}
      // with purpose set to e.g. "Growth plan subscription", so it failed
      // validation three ways over and the M-Pesa subscription button 400'd on
      // every click. Found by the post-M3 client/server contract sweep.
      const payload = pendingAction.kind === 'plan'
        ? {
            // Server-quoted price, and planType/product so the M-Pesa callback
            // knows what to activate — account_reference is a constant and
            // description is 20 chars, neither of which identifies a plan.
            // The server re-checks this amount against its own table before
            // activating, so a tampered value fails verification rather than
            // buying a plan cheaply.
            amount:           priceOf(pendingAction.planType)!,
            accountReference: 'SUBSCRIPT',
            description:      `${PLAN_COPY.find((p) => p.type === pendingAction.planType)!.label} plan`.slice(0, 20),
            purpose:          'subscription' as const,
            planType:         pendingAction.planType,
            product,
          }
        : {
            amount:           pendingAction.amount,
            accountReference: 'SMSTOPUP',
            description:      'SMS credits top-up'.slice(0, 20),
            purpose:          'sms_topup' as const,
          };
      const res = await stkPush.mutateAsync({ phone, ...payload });
      setCheckoutId(res.checkoutRequestId);
      setPolling(true);
    } catch (err) {
      toast({ variant: 'destructive', title: 'STK push failed', description: getErrorMessage(err) });
    }
  };

  const current = billingData?.current;
  const currentPlanType = current?.planType ?? 'starter';
  const product = billingData?.product ?? 'kitabu_yetu';

  /** Server-quoted monthly fee. null while loading; 0 means negotiated, not free. */
  const priceOf = (type: PlanType): number | null =>
    billingData?.plans.find((p) => p.plan === type)?.monthlyFee ?? null;

  /** Enterprise is negotiated — it is never sold through the self-serve STK flow. */
  const isNegotiated = (type: PlanType) => type === 'enterprise';

  const smsCredits = smsBalance ? Number(smsBalance.credits) : null;
  const smsRate    = smsBalance ? Number(smsBalance.rate) : null;
  const smsKesValue = smsCredits != null && smsRate != null ? smsCredits * smsRate : null;
  const smsLow = smsCredits != null && smsCredits < LOW_SMS_CREDITS_THRESHOLD;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Billing"
        description={`Current plan: ${currentPlanType.charAt(0).toUpperCase()}${currentPlanType.slice(1)}${current?.expiresAt ? ` · expires ${new Date(current.expiresAt).toLocaleDateString()}` : ''}`}
      />

      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-4">
        {PLAN_COPY.map((plan) => {
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
                      : `KES ${price.toLocaleString()} / month`}
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare size={16} className="text-brand-500" />
              SMS Credits
            </CardTitle>
            <CardDescription>Used for member notifications, reminders, and bulk campaigns.</CardDescription>
          </div>
          {smsLow && <Badge variant="warning">Low balance</Badge>}
        </CardHeader>
        <CardContent>
          {smsBalanceLoading ? (
            <div className="h-8 w-40 bg-muted rounded animate-pulse" />
          ) : (
            <p className="text-2xl font-bold text-foreground">
              KES {smsKesValue != null ? smsKesValue.toFixed(2) : '0.00'}
              <span className="text-sm font-normal text-muted-foreground ml-2">
                ({smsCredits != null ? smsCredits.toFixed(0) : '0'} credits{smsRate != null ? ` · KES ${smsRate.toFixed(2)}/credit` : ''})
              </span>
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center gap-2">
          {SMS_TOPUP_PRESETS.map((amt) => (
            <Button
              key={amt}
              type="button"
              size="sm"
              variant={topupAmount === amt ? 'default' : 'outline'}
              onClick={() => setTopupAmount(amt)}
            >
              KES {amt.toLocaleString()}
            </Button>
          ))}
          <Input
            type="number"
            min={1}
            value={topupAmount}
            onChange={(e) => setTopupAmount(Number(e.target.value))}
            className="w-28 h-9"
          />
          <Button className="ml-auto" onClick={handleBuySmsCredits}>
            Buy via M-Pesa
          </Button>
        </CardFooter>
      </Card>

      <Dialog open={mpesaOpen} onOpenChange={(o) => { if (!polling) setMpesaOpen(o); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Pay via M-Pesa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {polling ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <Loader2 className="animate-spin h-8 w-8 text-brand-500"/>
                <p className="text-sm text-center text-muted-foreground">
                  Check your phone for the M-Pesa prompt.<br/>Waiting for payment confirmation…
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1">
                  <Label>M-Pesa phone number</Label>
                  <Input
                    placeholder="0712345678"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <p className="text-sm text-muted-foreground">
                  You will receive an M-Pesa prompt to pay{' '}
                  <strong>
                    KES {(pendingAction?.kind === 'plan'
                      ? priceOf(pendingAction.planType)
                      : pendingAction?.amount
                    )?.toLocaleString()}
                  </strong>
                </p>
                <Button className="w-full" onClick={handleMpesaPay} loading={stkPush.isPending} disabled={!phone}>
                  Send M-Pesa prompt
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
