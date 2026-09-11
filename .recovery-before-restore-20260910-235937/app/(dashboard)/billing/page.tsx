'use client';

import { useState, useCallback } from 'react';
import { MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/shared/page-header';
import { PlanPurchase, useCurrentPlanSummary } from '@/components/billing/plan-purchase';
import { MpesaPayDialog } from '@/components/billing/mpesa-pay-dialog';
import { useSmsCreditBalance, billingKeys } from '@/hooks/use-billing';
import { useStkCheckout } from '@/hooks/use-stk-checkout';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';

const SMS_TOPUP_PRESETS = [500, 1000, 2500, 5000];
/** Below this many credits the balance card switches to a "Low balance" warning. */
const LOW_SMS_CREDITS_THRESHOLD = 50;

export default function BillingPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: smsBalance, isLoading: smsBalanceLoading } = useSmsCreditBalance();

  const [topupAmount, setTopupAmount] = useState<number>(SMS_TOPUP_PRESETS[0]);

  const onTopupPaid = useCallback((amount: number) => {
    // Crediting itself happens server-side off the M-Pesa callback
    // (mpesa/callback/route.ts → billingService.addSmsCredits) — nothing left
    // to do here but refresh the balance and confirm. Note the callback is
    // processed asynchronously (Next's after()), so the invalidated balance
    // query may still read the pre-credit value on the first refetch; the
    // balance card catches up on the next poll/refocus.
    qc.invalidateQueries({ queryKey: billingKeys.smsCredits });
    toast({ title: 'Credits added', description: `KES ${amount.toLocaleString()} of SMS credits added to your balance` });
  }, [qc, toast]);

  const topupCheckout = useStkCheckout(onTopupPaid);

  const handleBuySmsCredits = () => {
    if (!topupAmount || topupAmount < 1) return;
    topupCheckout.start({
      amount:           Math.round(topupAmount),
      accountReference: 'SMSTOPUP',
      description:      'SMS credits top-up'.slice(0, 20),
      purpose:          'sms_topup' as const,
    });
  };

  const smsCredits  = smsBalance ? Number(smsBalance.credits) : null;
  const smsRate     = smsBalance ? Number(smsBalance.rate) : null;
  const smsKesValue = smsCredits != null && smsRate != null ? smsCredits * smsRate : null;
  const smsLow      = smsCredits != null && smsCredits < LOW_SMS_CREDITS_THRESHOLD;

  return (
    <div className="space-y-6">
      <PageHeader title="Billing" description={useCurrentPlanSummary('kitabu_yetu')} />

      <PlanPurchase product="kitabu_yetu" />

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
            <>
              <p className="text-2xl font-bold text-foreground">
                KES {smsKesValue != null ? smsKesValue.toFixed(2) : '0.00'}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({smsCredits != null ? smsCredits.toFixed(0) : '0'} purchased{smsRate != null ? ` · KES ${smsRate.toFixed(2)}/credit` : ''})
                </span>
              </p>
              {/* The plan's BUNDLED messages, a separate pool from purchased
                  top-ups and drawn from first. Showing only the purchased
                  balance made a group that had just paid for a plan including
                  50 SMS believe its package came with none. */}
              {smsBalance && smsBalance.allowanceIncluded > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Plan allowance:{' '}
                  <span className="font-medium text-foreground">
                    {smsBalance.allowanceRemaining} of {smsBalance.allowanceIncluded}
                  </span>{' '}
                  messages left this month
                </p>
              )}
            </>
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

      <MpesaPayDialog checkout={topupCheckout} />
    </div>
  );
}
