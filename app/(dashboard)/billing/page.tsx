'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useBillingPlans, useUpgradePlan, useStkPush, usePollMpesa } from '@/hooks/use-billing';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/lib/auth/context';
import { cn, formatKES } from '@/lib/utils';

const PLANS = [
  { type: 'starter',    label: 'Starter',    price: 0,     maxMembers: 10,   features: ['Basic reporting', 'M-Pesa integration', 'SMS (50/mo)'] },
  { type: 'growth',     label: 'Growth',     price: 2500,  maxMembers: 100,  features: ['All Starter features', 'Advanced reports', 'SMS (500/mo)', 'Accounting module'] },
  { type: 'enterprise', label: 'Enterprise', price: 8000,  maxMembers: 9999, features: ['All Growth features', 'Unlimited SMS', 'NGO portal', 'API access', 'Priority support'] },
];

export default function BillingPage() {
  const { user }  = useAuth();
  const { toast } = useToast();
  const { data: billingData, isLoading } = useBillingPlans();
  const upgradePlan = useUpgradePlan();
  const stkPush     = useStkPush();

  const [checkoutId, setCheckoutId]   = useState<string | null>(null);
  const [polling, setPolling]         = useState(false);
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const [phone, setPhone]             = useState('');
  const [mpesaOpen, setMpesaOpen]     = useState(false);

  const { data: mpesaStatus } = usePollMpesa(checkoutId, polling);

  // Effect responds to M-Pesa polling result (external async system).
  // The setState calls here stop polling and close the modal on terminal
  // status — this is the "subscribe to external system" pattern, not the
  // copy-data-to-state anti-pattern the rule normally guards against.
  useEffect(() => {
    if (!mpesaStatus) return;
    if (mpesaStatus.status === 'completed') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPolling(false);
      setMpesaOpen(false);
      upgradePlan.mutate(pendingPlan!, {
        onSuccess: () => toast({ title: 'Plan upgraded!', description: `Now on ${pendingPlan} plan` }),
        onError:   (err: any) => toast({ variant: 'destructive', title: 'Upgrade failed', description: err.message }),
      });
    } else if (mpesaStatus.status === 'failed') {
      setPolling(false);
      toast({ variant: 'destructive', title: 'Payment failed', description: 'M-Pesa payment was not completed' });
    }
  }, [mpesaStatus, pendingPlan, toast, upgradePlan]);

  const handleSelectPlan = (planType: string) => {
    if (planType === 'starter') return;
    setPendingPlan(planType);
    setMpesaOpen(true);
  };

  const handleMpesaPay = async () => {
    const plan = PLANS.find((p) => p.type === pendingPlan);
    if (!plan || !phone) return;
    try {
      const res = await stkPush.mutateAsync({ phone, amount: plan.price, purpose: `${plan.label} plan subscription` });
      setCheckoutId(res.checkoutRequestId);
      setPolling(true);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'STK push failed', description: err.message });
    }
  };

  const current = billingData?.current;
  const currentPlanType = current?.planType ?? 'starter';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          Current plan: <span className="font-semibold capitalize">{currentPlanType}</span>
          {current?.expiresAt && ` · expires ${new Date(current.expiresAt).toLocaleDateString()}`}
        </p>
      </div>

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
                  <strong>KES {PLANS.find((p) => p.type === pendingPlan)?.price?.toLocaleString()}</strong>
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
