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

type PlanType = UpgradePlanInput['planType'];

const PLANS: { type: PlanType; label: string; price: number; maxMembers: number; features: string[] }[] = [
  { type: 'starter',    label: 'Starter',    price: 0,     maxMembers: 10,   features: ['Basic reporting', 'M-Pesa integration', 'SMS (50/mo)'] },
  { type: 'growth',     label: 'Growth',     price: 2500,  maxMembers: 100,  features: ['All Starter features', 'Advanced reports', 'SMS (500/mo)', 'Accounting module'] },
  { type: 'enterprise', label: 'Enterprise', price: 8000,  maxMembers: 9999, features: ['All Growth features', 'Unlimited SMS', 'Enterprise portal', 'API access', 'Priority support'] },
];

const SMS_TOPUP_PRESETS = [500, 1000, 2500, 5000];
/** Below this many credits the balance card switches to a "Low balance" warning. */
const LOW_SMS_CREDITS_THRESHOLD = 50;

// One STK-push flow (phone entry → prompt → poll) is shared by both actions
// this page can trigger — plan upgrade and SMS credit top-up — so there is
// exactly one payment dialog, keyed off which action is pending.
type PendingAction =
  | { kind: 'plan';       planType: PlanType }
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
    if (planType === 'starter') return;
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
            amount:           PLANS.find((p) => p.type === pendingAction.planType)!.price,
            accountReference: 'SUBSCRIPT',
            description:      `${PLANS.find((p) => p.type === pendingAction.planType)!.label} plan`.slice(0, 20),
            purpose:          'subscription' as const,
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

      <div className="grid gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => {
          const isCurrent = plan.type === currentPlanType;
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
                  {plan.price === 0 ? 'Free forever' : `KES ${plan.price.toLocaleString()} / month`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">Up to {plan.maxMembers === 9999 ? 'unlimited' : plan.maxMembers} members</p>
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
                  variant={isCurrent ? 'outline' : 'default'}
                  disabled={isCurrent || isLoading}
                  onClick={() => handleSelectPlan(plan.type)}
                >
                  {isCurrent ? 'Current plan' : plan.price === 0 ? 'Downgrade' : 'Upgrade via M-Pesa'}
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
                      ? PLANS.find((p) => p.type === pendingAction.planType)?.price
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
