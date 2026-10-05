'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSetCampaignPayoutDestination } from '@/hooks/use-campaigns';
import { useToast } from '@/hooks/use-toast';
import { cn, getErrorMessage } from '@/lib/utils';
import {
  describePayoutDestination,
  type PayoutDestination,
  type PayoutFields,
  type PayoutMethod,
} from '@/lib/campaigns/payout-destination';

const METHODS: { value: PayoutMethod; label: string; hint: string }[] = [
  { value: 'phone', label: 'M-Pesa phone', hint: 'Paid to a person’s phone (B2C)' },
  { value: 'paybill', label: 'Paybill', hint: 'Paid to a business account, e.g. a hospital or school' },
  { value: 'till', label: 'Till (Buy Goods)', hint: 'Paid to a business till number' },
];

/**
 * Where withdrawn funds go — editable only while the campaign is a draft
 * (campaignsService.setPayoutDestination enforces that server-side).
 */
export function PayoutDestinationEditor({ campaignId, campaign }: { campaignId: string; campaign: PayoutFields }) {
  const { toast } = useToast();
  const setDestination = useSetCampaignPayoutDestination(campaignId);
  const [method, setMethod] = useState<PayoutMethod>(campaign.payout_method);
  const [phone, setPhone] = useState('');
  const [shortcode, setShortcode] = useState('');
  const [account, setAccount] = useState('');
  const [payeeName, setPayeeName] = useState('');

  const draft: PayoutDestination | null =
    method === 'phone'
      ? phone.trim()
        ? { method, phone: phone.trim() }
        : null
      : method === 'paybill'
        ? shortcode.trim() && account.trim() && payeeName.trim()
          ? { method, shortcode: shortcode.trim(), account: account.trim(), payeeName: payeeName.trim() }
          : null
        : shortcode.trim() && payeeName.trim()
          ? { method, shortcode: shortcode.trim(), payeeName: payeeName.trim() }
          : null;

  const onSave = async () => {
    if (!draft) return;
    try {
      await setDestination.mutateAsync(draft);
      toast({ title: 'Payout destination saved' });
      setPhone('');
      setShortcode('');
      setAccount('');
      setPayeeName('');
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Payout destination</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Where withdrawn funds are sent once this campaign is live — a phone, or a business paybill or till so the
          money goes straight to the hospital, school or supplier. Required before submitting for review, and can only
          be changed while still a draft.
        </p>

        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="sr-only">Payout method</legend>
          {METHODS.map((m) => (
            <label
              key={m.value}
              className={cn(
                'flex cursor-pointer flex-col rounded-md border p-3 text-sm transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring',
                method === m.value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50',
              )}
            >
              <span className="flex items-center gap-2 font-medium">
                <input
                  type="radio"
                  name="payout-method"
                  value={m.value}
                  checked={method === m.value}
                  onChange={() => setMethod(m.value)}
                  className="accent-[hsl(var(--primary))]"
                />
                {m.label}
              </span>
              <span className="mt-1 text-xs text-muted-foreground">{m.hint}</span>
            </label>
          ))}
        </fieldset>

        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          {method === 'phone' ? (
            <div className="space-y-1 sm:col-span-2 sm:max-w-sm">
              <Label htmlFor="payout-phone">M-Pesa phone number</Label>
              <Input
                id="payout-phone"
                inputMode="tel"
                placeholder="07XXXXXXXX"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label htmlFor="payout-shortcode">{method === 'paybill' ? 'Paybill number' : 'Till number'}</Label>
                <Input
                  id="payout-shortcode"
                  inputMode="numeric"
                  placeholder="e.g. 247247"
                  value={shortcode}
                  onChange={(e) => setShortcode(e.target.value)}
                />
              </div>
              {method === 'paybill' && (
                <div className="space-y-1">
                  <Label htmlFor="payout-account">Account number</Label>
                  <Input
                    id="payout-account"
                    placeholder="As the business gave it to you"
                    maxLength={20}
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                  />
                </div>
              )}
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="payout-payee">Business name</Label>
                <Input
                  id="payout-payee"
                  placeholder="e.g. Kenyatta National Hospital"
                  maxLength={120}
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Shown to the Kitabu Yetu reviewer and to officers approving each withdrawal.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={onSave} disabled={!draft || setDestination.isPending}>
            {setDestination.isPending ? 'Saving…' : 'Save destination'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Currently set: <span className="font-medium text-foreground">{describePayoutDestination(campaign)}</span>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
